"""Operaciones comerciales de Merqia (solo local; sin cobro ni boleta tributaria).

Todos los importes se expresan como pesos chilenos enteros. Django calcula los
precios y el total en el servidor: nunca se confía en el importe enviado por React.
"""
import re
import sqlite3
from contextlib import closing
from zipfile import ZipFile, ZIP_DEFLATED
from pathlib import Path
from uuid import uuid4

from django.conf import settings
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import F, Sum
from django.http import FileResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from .models import Caja, ConfiguracionComercio, DetalleVenta, MovimientoCaja, Producto, Venta
from .views import acceso, error, leer_json, es_admin

MAX_PESOS = 2_147_483_647


def entero(valor, campo, *, minimo=0, maximo=MAX_PESOS):
    """Acepta enteros exactos, no bool, float o cadenas decimales."""
    if isinstance(valor, bool) or isinstance(valor, float):
        raise ValueError(f'{campo}: escribe un número entero.')
    try:
        if isinstance(valor, str) and not re.fullmatch(r'[0-9]+', valor):
            raise ValueError()
        numero = int(valor)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f'{campo}: escribe un número entero.') from None
    if numero < minimo or numero > maximo:
        raise ValueError(f'{campo}: escribe un valor entre {minimo} y {maximo:,}.')
    return numero


def configuracion():
    return ConfiguracionComercio.objects.get_or_create(pk=1, defaults={'dias_alerta': 7})[0]


def caja_abierta():
    return Caja.objects.filter(fecha_cierre__isnull=True).select_related('usuario').first()


def saldo_efectivo(caja):
    ingresos_ventas = Venta.objects.filter(caja=caja, metodo_pago='efectivo').aggregate(s=Sum('total'))['s'] or 0
    ingresos = MovimientoCaja.objects.filter(caja=caja, tipo='ingreso').aggregate(s=Sum('monto'))['s'] or 0
    retiros = MovimientoCaja.objects.filter(caja=caja, tipo='retiro').aggregate(s=Sum('monto'))['s'] or 0
    return caja.monto_inicial + ingresos_ventas + ingresos - retiros


def serializar_caja(caja, mostrar_movimientos=True):
    if caja is None:
        return None
    ventas = Venta.objects.filter(caja=caja)
    movs = MovimientoCaja.objects.filter(caja=caja)
    datos = {
        'id': caja.pk,
        'responsable': caja.usuario.get_full_name() or caja.usuario.username,
        'fecha_apertura': caja.fecha_apertura.isoformat(),
        'fecha_cierre': caja.fecha_cierre.isoformat() if caja.fecha_cierre else None,
        'monto_inicial': caja.monto_inicial,
        'monto_contado': caja.monto_contado,
        'diferencia': caja.diferencia,
        'saldo_esperado': caja.monto_final if caja.fecha_cierre else saldo_efectivo(caja),
        'ventas_efectivo': ventas.filter(metodo_pago='efectivo').aggregate(s=Sum('total'))['s'] or 0,
        'ventas_tarjeta': ventas.filter(metodo_pago='tarjeta').aggregate(s=Sum('total'))['s'] or 0,
        'total_ventas': ventas.count(),
        'total_ingresos': movs.filter(tipo='ingreso').aggregate(s=Sum('monto'))['s'] or 0,
        'total_retiros': movs.filter(tipo='retiro').aggregate(s=Sum('monto'))['s'] or 0,
    }
    if mostrar_movimientos:
        datos['movimientos'] = [{
            'id': m.pk, 'tipo': m.tipo, 'monto': m.monto, 'motivo': m.motivo,
            'fecha_hora': m.fecha_hora.isoformat(),
            'usuario': m.usuario.username,
        } for m in movs.select_related('usuario').order_by('-fecha_hora', '-pk')[:30]]
    return datos


def serializar_venta(v, incluir_detalles=True):
    datos = {
        'id': v.pk, 'fecha_hora': v.fecha_hora.isoformat(), 'caja_id': v.caja_id,
        'usuario': v.usuario.get_full_name() or v.usuario.username,
        'metodo_pago': v.metodo_pago, 'total': v.total,
        'monto_recibido': v.monto_recibido, 'vuelto': v.vuelto,
    }
    if incluir_detalles:
        datos['items'] = [{
            'producto_id': d.producto_id, 'nombre': d.nombre_producto or d.producto.nombre,
            'codigo': d.codigo_producto or d.producto.codigo, 'cantidad': d.cantidad,
            'precio_unitario': d.precio_unitario, 'subtotal': d.subtotal,
        } for d in v.detalles.select_related('producto').order_by('pk')]
    return datos


@require_http_methods(['GET'])
def estado(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    hoy = timezone.localdate()
    ventas_hoy = Venta.objects.filter(fecha_hora__date=hoy)
    if not es_admin(request.user):
        ventas_hoy = ventas_hoy.filter(usuario=request.user)
    c = caja_abierta()
    historial = Caja.objects.select_related('usuario').order_by('-fecha_apertura', '-pk')[:12]
    return JsonResponse({
        'caja': serializar_caja(c),
        'historial': [serializar_caja(x, mostrar_movimientos=False) for x in historial],
        'configuracion': {'dias_alerta': configuracion().dias_alerta},
        'ventas_hoy': ventas_hoy.count(),
        'total_hoy': ventas_hoy.aggregate(s=Sum('total'))['s'] or 0,
        'ultimas_ventas': [serializar_venta(v, incluir_detalles=False) for v in ventas_hoy.order_by('-fecha_hora', '-pk')[:10]],
        'es_admin': es_admin(request.user),
    })


@require_http_methods(['POST'])
def abrir_caja(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    try:
        fondo = entero(datos.get('monto_inicial'), 'Fondo inicial')
        with transaction.atomic():
            if Caja.objects.filter(fecha_cierre__isnull=True).exists():
                return error('Ya hay una caja abierta. Continúa con ese turno.', 409)
            c = Caja.objects.create(usuario=request.user, monto_inicial=fondo)
    except ValueError as exc:
        return error(str(exc))
    except (IntegrityError, OperationalError):
        return error('La caja ya fue abierta desde otra sesión. Actualiza la pantalla.', 409)
    return JsonResponse({'caja': serializar_caja(c)}, status=201)


@require_http_methods(['POST'])
def crear_venta(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    token = datos.get('token')
    if not isinstance(token, str) or not re.fullmatch(r'[a-fA-F0-9-]{32,36}', token):
        return error('Identificador de venta inválido. Recarga la aplicación.')
    anterior = Venta.objects.filter(token_operacion=token).first()
    if anterior:
        return JsonResponse({'venta': serializar_venta(anterior), 'repetida': True})
    items = datos.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        return error('Agrega entre 1 y 100 productos a la venta.')
    if datos.get('metodo_pago') not in ('efectivo', 'tarjeta'):
        return error('Elige Efectivo o Tarjeta.')
    metodo = datos['metodo_pago']
    try:
        agrupados = {}
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('El carrito tiene un producto inválido.')
            pk = entero(item.get('producto_id'), 'Producto', minimo=1)
            cantidad = entero(item.get('cantidad'), 'Cantidad', minimo=1, maximo=100000)
            agrupados[pk] = agrupados.get(pk, 0) + cantidad
            if agrupados[pk] > 100000:
                raise ValueError('Demasiadas unidades de un mismo producto.')
        with transaction.atomic():
            # Consulta dentro de la transacción y actualización condicional F() para SQLite.
            c = Caja.objects.select_for_update().filter(fecha_cierre__isnull=True).first()
            if c is None:
                return error('Abre caja antes de registrar una venta.', 409)
            productos = list(Producto.objects.filter(pk__in=agrupados, activo=True).order_by('pk'))
            if len(productos) != len(agrupados):
                return error('Algún producto ya no existe. Revisa el carrito.', 409)
            total = 0
            hoy = timezone.localdate()
            for p in productos:
                if p.vencimiento and p.vencimiento < hoy:
                    return error(f'{p.nombre} está vencido y no se puede vender.', 409)
                if p.stock < agrupados[p.pk]:
                    return error(f'No hay suficientes unidades de {p.nombre}. Disponibles: {p.stock}.', 409)
                total += p.precio * agrupados[p.pk]
                if total > MAX_PESOS:
                    return error('El total supera el monto máximo permitido.')
            if metodo == 'efectivo' and saldo_efectivo(c) + total > MAX_PESOS:
                return error('Esta caja supera el saldo máximo permitido. Cierra el turno y abre otro.', 409)
            recibido = entero(datos.get('monto_recibido') if metodo == 'efectivo' else 0, 'Monto recibido')
            if metodo == 'efectivo' and recibido < total:
                return error('El efectivo recibido no alcanza para cubrir el total.')
            vuelto = recibido - total if metodo == 'efectivo' else 0
            for p in productos:
                cambio = Producto.objects.filter(pk=p.pk, activo=True, stock__gte=agrupados[p.pk]).update(stock=F('stock') - agrupados[p.pk])
                if cambio != 1:
                    raise ValueError(f'Cambió el stock de {p.nombre}. Actualiza los productos y vuelve a intentar.')
            v = Venta.objects.create(
                caja=c, usuario=request.user, metodo_pago=metodo,
                monto_recibido=recibido, vuelto=vuelto, total=total, token_operacion=token,
            )
            DetalleVenta.objects.bulk_create([
                DetalleVenta(venta=v, producto=p, cantidad=agrupados[p.pk],
                             precio_unitario=p.precio, subtotal=p.precio * agrupados[p.pk],
                             nombre_producto=p.nombre, codigo_producto=p.codigo) for p in productos
            ])
    except ValueError as exc:
        return error(str(exc), 409)
    except (IntegrityError, OperationalError):
        anterior = Venta.objects.filter(token_operacion=token).first()
        if anterior:
            return JsonResponse({'venta': serializar_venta(anterior), 'repetida': True})
        return error('La venta no pudo confirmarse. Actualiza e inténtalo otra vez.', 409)
    return JsonResponse({'venta': serializar_venta(v), 'repetida': False}, status=201)


@require_http_methods(['POST'])
def registrar_movimiento(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    tipo = datos.get('tipo')
    motivo = datos.get('motivo')
    if tipo not in ('ingreso', 'retiro'):
        return error('Selecciona ingreso o retiro de efectivo.')
    if not isinstance(motivo, str) or not 3 <= len(motivo.strip()) <= 200:
        return error('Explica el motivo del movimiento (3 a 200 caracteres).')
    try:
        monto = entero(datos.get('monto'), 'Monto', minimo=1)
        with transaction.atomic():
            c = Caja.objects.select_for_update().filter(fecha_cierre__isnull=True).first()
            if c is None:
                return error('No hay una caja abierta.', 409)
            saldo = saldo_efectivo(c)
            if tipo == 'retiro' and monto > saldo:
                return error('No puedes retirar más efectivo del que debería haber en caja.', 409)
            if tipo == 'ingreso' and saldo + monto > MAX_PESOS:
                return error('Este ingreso excede el máximo permitido para un turno.', 409)
            m = MovimientoCaja.objects.create(caja=c, usuario=request.user, tipo=tipo, monto=monto, motivo=motivo.strip())
    except ValueError as exc:
        return error(str(exc))
    except OperationalError:
        return error('La caja está ocupada. Vuelve a intentar.', 409)
    return JsonResponse({'id': m.pk, 'caja': serializar_caja(c)}, status=201)


def crear_respaldo():
    """Copia SQLite consistente y fotografías en un ZIP privado, sin datos externos."""
    ruta_db = settings.DATABASES['default']['NAME']
    if str(ruta_db) == ':memory:' or not Path(ruta_db).is_file():
        return None
    carpeta = Path(settings.RESPALDOS_DIR)
    carpeta.mkdir(parents=True, exist_ok=True)
    nombre = f'merqia_{timezone.localtime():%Y%m%d_%H%M%S}_{uuid4().hex[:8]}'
    temporal_db = carpeta / f'{nombre}.sqlite3.tmp'
    temporal_zip = carpeta / f'{nombre}.zip.tmp'
    salida = carpeta / f'{nombre}.zip'
    try:
        with closing(sqlite3.connect(str(ruta_db))) as origen, closing(sqlite3.connect(str(temporal_db))) as destino:
            origen.backup(destino)
        with ZipFile(temporal_zip, 'w', ZIP_DEFLATED) as archivo:
            archivo.write(temporal_db, 'db.sqlite3')
            media = Path(settings.MEDIA_ROOT)
            if media.exists():
                for foto in media.rglob('*'):
                    if foto.is_file() and not foto.is_symlink():
                        archivo.write(foto, f'media/{foto.relative_to(media).as_posix()}')
            archivo.writestr('COMO_RESTAURAR.txt',
                '1. Cierra Merqia (Django y React).\n'
                '2. Haz copia de tu carpeta backend actual.\n'
                '3. Extrae db.sqlite3 en backend y media/ en backend/media.\n'
                '4. Inicia de nuevo el sistema.\n'
                'Este respaldo contiene datos de la tienda y contrasenas protegidas. No lo publiques.\n')
        temporal_zip.replace(salida)
    finally:
        if temporal_db.exists():
            temporal_db.unlink()
        if temporal_zip.exists():
            temporal_zip.unlink()
    return salida


@require_http_methods(['POST'])
def cerrar_caja(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    try:
        contado = entero(datos.get('monto_contado'), 'Dinero contado')
        with transaction.atomic():
            c = Caja.objects.select_for_update().filter(fecha_cierre__isnull=True).first()
            if not c:
                return error('No hay una caja abierta.', 409)
            esperado = saldo_efectivo(c)
            if esperado < 0 or esperado > MAX_PESOS:
                return error('El saldo de caja no es válido; solicita revisión administrativa.', 409)
            c.monto_contado = contado
            c.monto_final = esperado
            c.diferencia = contado - esperado
            c.fecha_cierre = timezone.now()
            c.save(update_fields=['monto_contado', 'monto_final', 'diferencia', 'fecha_cierre'])
    except ValueError as exc:
        return error(str(exc))
    except OperationalError:
        return error('Otra persona está utilizando la caja. Inténtalo de nuevo.', 409)
    try:
        archivo = crear_respaldo()
        respaldo = bool(archivo)
    except (OSError, sqlite3.Error):
        respaldo = False
    return JsonResponse({'caja': serializar_caja(c), 'respaldo_creado': respaldo,
                         'mensaje': 'Caja cerrada. Se generó respaldo local.' if respaldo else
                         'Caja cerrada. No se pudo guardar el respaldo; un administrador debe generarlo manualmente.'})


@require_http_methods(['GET'])
def listar_ventas(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    qs = Venta.objects.select_related('usuario').order_by('-fecha_hora', '-pk')
    if not es_admin(request.user):
        qs = qs.filter(usuario=request.user)
    return JsonResponse({'ventas': [serializar_venta(v) for v in qs[:100]]})


@require_http_methods(['PUT'])
def guardar_configuracion(request):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    try:
        dias = entero(datos.get('dias_alerta'), 'Días de aviso', minimo=1, maximo=90)
    except ValueError as exc:
        return error(str(exc))
    c = configuracion()
    c.dias_alerta = dias
    c.save(update_fields=['dias_alerta'])
    return JsonResponse({'configuracion': {'dias_alerta': dias}})


@require_http_methods(['POST'])
def descargar_respaldo(request):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    try:
        archivo = crear_respaldo()
    except (OSError, sqlite3.Error):
        return error('No se pudo generar el respaldo. Revisa el espacio del disco.', 500)
    if archivo is None:
        return error('La base de datos debe estar almacenada en un archivo para respaldarla.', 500)
    return FileResponse(open(archivo, 'rb'), as_attachment=True, filename=archivo.name,
                        content_type='application/zip')
