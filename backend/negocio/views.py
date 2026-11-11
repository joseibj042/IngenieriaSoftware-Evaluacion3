"""API local para Merqia: sesiones, productos y equipo de trabajo.

Las operaciones sensibles comprueban permisos en Django; la interfaz no otorga permisos.
"""
import json
import re
from io import BytesIO
from uuid import uuid4
from datetime import date, timedelta
from django.utils import timezone

from django.contrib.auth import authenticate, get_user_model, login, logout, update_session_auth_hash
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum, Count
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from .models import Categoria, Producto, ConfiguracionComercio, FotoPerfil


def error(mensaje, codigo=400):
    return JsonResponse({'error': mensaje}, status=codigo)


def es_admin(user):
    return user.is_authenticated and (user.is_superuser or user.groups.filter(name='Administrador').exists())


def tiene_rol(user):
    return es_admin(user) or user.groups.filter(name='Cajero').exists()


def rol_usuario(user):
    if es_admin(user):
        return 'Administrador'
    if user.groups.filter(name='Cajero').exists():
        return 'Cajero'
    return 'Sin rol'


def perfil(user, actual=None):
    foto = getattr(user, 'foto_perfil', None)
    return {
        'id': user.pk,
        'usuario': user.username,
        'nombre': user.get_full_name() or user.username,
        'foto': foto.imagen.url if foto and foto.imagen else None,
        'rol': rol_usuario(user),
        'activo': user.is_active,
        'protegido': user.is_superuser,
        'es_actual': actual is not None and user.pk == actual.pk,
        'ultimo_acceso': user.last_login.isoformat() if user.last_login else None,
        'creado_el': user.date_joined.isoformat() if user.date_joined else None,
    }


def acceso(request, admin=False):
    if not request.user.is_authenticated:
        return error('Tu sesión terminó. Vuelve a ingresar.', 401)
    if not tiene_rol(request.user):
        return error('Tu cuenta no tiene un permiso asignado. Consulta con el administrador.', 403)
    if admin and not es_admin(request.user):
        return error('Solo el administrador puede realizar esta acción.', 403)
    return None


def leer_json(request):
    try:
        valor = json.loads(request.body.decode('utf-8'))
        return valor if isinstance(valor, dict) else None
    except (UnicodeDecodeError, ValueError):
        return None


@ensure_csrf_cookie
@require_http_methods(['GET'])
def csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})


@require_http_methods(['POST'])
def iniciar_sesion(request):
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    nombre = str(datos.get('usuario', '')).strip()
    clave = str(datos.get('clave', ''))
    user = authenticate(request, username=nombre, password=clave)
    if user is None:
        return error('Usuario o contraseña incorrectos.', 401)
    if not tiene_rol(user):
        return error('Esta cuenta no tiene acceso. Consulta con el administrador.', 403)
    login(request, user)
    return JsonResponse({'usuario': perfil(user, user), 'csrfToken': get_token(request)})


@require_http_methods(['POST'])
def cerrar_sesion(request):
    logout(request)
    return JsonResponse({'ok': True})


@require_http_methods(['GET'])
def sesion_actual(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    return JsonResponse({'usuario': perfil(request.user, request.user)})


@require_http_methods(['GET'])
def resumen(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    hoy = timezone.localdate()
    dias_alerta = ConfiguracionComercio.objects.filter(pk=1).values_list('dias_alerta', flat=True).first() or 7
    limite = hoy + timedelta(days=dias_alerta)
    return JsonResponse({
        'dias_alerta': dias_alerta,
        'productos': Producto.objects.filter(activo=True).count(),
        'unidades': Producto.objects.filter(activo=True).aggregate(total=Sum('stock'))['total'] or 0,
        'stock_bajo': Producto.objects.filter(activo=True, stock__lt=5).count(),
        'por_vencer': Producto.objects.filter(activo=True, vencimiento__gte=hoy, vencimiento__lte=limite).count(),
        'vencidos': Producto.objects.filter(activo=True, vencimiento__lt=hoy).count(),
    })


def serializar_producto(p):
    return {'id': p.pk, 'activo': p.activo, 'codigo': p.codigo, 'nombre': p.nombre,
            'precio': p.precio, 'stock': p.stock,
            'categoria_id': p.categoria_id,
            'categoria': p.categoria.nombre if p.categoria_id else None,
            'imagen': p.imagen.url if p.imagen else None,
            'vencimiento': p.vencimiento.isoformat() if p.vencimiento else None}


def datos_peticion(request):
    if request.content_type.startswith('multipart/form-data'):
        return request.POST.dict()
    return leer_json(request)


def validar_imagen(request):
    archivo = request.FILES.get('imagen')
    if not archivo:
        return None
    if archivo.size > 3 * 1024 * 1024:
        raise ValueError('La imagen no puede superar los 3 MB.')
    if archivo.size == 0:
        raise ValueError('Selecciona una imagen válida.')
    try:
        with Image.open(archivo) as imagen:
            if imagen.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('Solo se permiten imágenes JPG, PNG o WEBP.')
            imagen.verify()
        archivo.seek(0)
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        archivo.seek(0)
        if isinstance(exc, ValueError):
            raise
        raise ValueError('El archivo no es una imagen válida.') from exc
    return archivo


def quitar_imagen_anterior(nombre):
    if nombre:
        transaction.on_commit(lambda: default_storage.delete(nombre))



def datos_cuenta(request):
    if request.content_type.startswith('multipart/form-data'):
        datos = request.POST.dict()
        if 'activo' in datos:
            if datos['activo'] not in ('true', 'false'):
                raise ValueError('Estado de usuario inválido.')
            datos['activo'] = datos['activo'] == 'true'
        return datos
    return leer_json(request)


def preparar_foto_perfil(request):
    archivo = request.FILES.get('foto')
    quitar = request.POST.get('quitar_foto') == 'true'
    if archivo is None:
        return None, quitar
    if quitar:
        raise ValueError('Selecciona una foto o indica que deseas quitarla.')
    if archivo.size == 0 or archivo.size > 3 * 1024 * 1024:
        raise ValueError('La foto debe tener un tamaño máximo de 3 MB.')
    try:
        with Image.open(archivo) as imagen:
            if imagen.format not in ('PNG', 'JPEG', 'WEBP'):
                raise ValueError('Solo se permiten fotos JPG, PNG o WEBP.')
            imagen.verify()
        archivo.seek(0)
        with Image.open(archivo) as imagen:
            if imagen.width > 6000 or imagen.height > 6000:
                raise ValueError('La foto es demasiado grande. El máximo es de 6000 × 6000 píxeles.')
            preparada = ImageOps.exif_transpose(imagen)
            preparada.thumbnail((512, 512), Image.Resampling.LANCZOS)
            salida = BytesIO()
            preparada.convert('RGB').save(salida, format='WEBP', quality=85, method=4)
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise ValueError('El archivo no es una fotografía válida.') from exc
    finally:
        archivo.seek(0)
    return ContentFile(salida.getvalue(), name=f'{uuid4().hex}.webp'), False


def guardar_foto_perfil(usuario, foto, quitar):
    if foto is None and not quitar:
        return
    registro = FotoPerfil.objects.filter(usuario=usuario).first()
    anterior = registro.imagen.name if registro and registro.imagen else ''
    if foto:
        if registro is None:
            registro = FotoPerfil(usuario=usuario)
        registro.imagen.save(foto.name, foto, save=True)
    elif registro:
        registro.delete()
    if anterior:
        transaction.on_commit(lambda nombre=anterior: default_storage.delete(nombre))


@require_http_methods(['POST'])
def mi_foto(request):
    fallo = acceso(request)
    if fallo is not None:
        return fallo
    if not request.content_type.startswith('multipart/form-data'):
        return error('Envía una foto o solicita quitar la foto actual.')
    try:
        foto, quitar = preparar_foto_perfil(request)
        if not foto and not quitar:
            return error('Selecciona una fotografía.')
        guardar_foto_perfil(request.user, foto, quitar)
    except ValueError as exc:
        return error(str(exc))
    return JsonResponse({'usuario': perfil(request.user, request.user)})

def serializar_categoria(c):
    return {'id': c.pk, 'nombre': c.nombre, 'productos': c.cantidad}


def validar_nombre_categoria(datos):
    nombre = str(datos.get('nombre', '')).strip()
    if not 2 <= len(nombre) <= 60:
        raise ValueError('El tipo debe tener entre 2 y 60 caracteres.')
    return nombre


@require_http_methods(['GET', 'POST'])
def categorias(request):
    fallo = acceso(request, admin=request.method != 'GET')
    if fallo is not None:
        return fallo
    if request.method == 'GET':
        filas = Categoria.objects.annotate(cantidad=Count('productos', filter=Q(productos__activo=True))).order_by('nombre')
        return JsonResponse({'categorias': [serializar_categoria(c) for c in filas]})
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    try:
        nombre = validar_nombre_categoria(datos)
        if Categoria.objects.filter(nombre__iexact=nombre).exists():
            return error('Ese tipo de producto ya existe.', 409)
        categoria = Categoria.objects.create(nombre=nombre)
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('Ese tipo de producto ya existe.', 409)
    return JsonResponse({'categoria': {'id': categoria.pk, 'nombre': categoria.nombre, 'productos': 0}}, status=201)


@require_http_methods(['PUT', 'DELETE'])
def categoria_detalle(request, pk):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    try:
        categoria = Categoria.objects.get(pk=pk)
    except Categoria.DoesNotExist:
        return error('Ese tipo de producto ya no existe.', 404)
    if request.method == 'DELETE':
        if categoria.productos.filter(activo=True).exists():
            return error('Primero cambia de tipo los productos que pertenecen a esta categoría.', 409)
        categoria.delete()
        return JsonResponse({'ok': True})
    datos = leer_json(request)
    if datos is None:
        return error('Solicitud inválida.')
    try:
        nombre = validar_nombre_categoria(datos)
        if Categoria.objects.filter(nombre__iexact=nombre).exclude(pk=pk).exists():
            return error('Ese tipo de producto ya existe.', 409)
        categoria.nombre = nombre
        categoria.save(update_fields=['nombre'])
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('Ese tipo de producto ya existe.', 409)
    return JsonResponse({'categoria': {'id': categoria.pk, 'nombre': categoria.nombre, 'productos': categoria.productos.filter(activo=True).count()}})


def datos_producto(data):
    codigo = str(data.get('codigo', '')).strip()
    nombre = str(data.get('nombre', '')).strip()
    if not codigo or len(codigo) > 40:
        raise ValueError('Escribe un código de hasta 40 caracteres.')
    if not nombre or len(nombre) > 140:
        raise ValueError('Escribe un nombre de hasta 140 caracteres.')

    def entero(valor, campo):
        if isinstance(valor, bool) or isinstance(valor, float):
            raise ValueError(f'{campo}: ingresa un número entero.')
        try:
            n = int(valor)
        except (TypeError, ValueError, OverflowError):
            raise ValueError(f'{campo}: ingresa un número entero.')
        if n < 0 or n > 2_147_483_647:
            raise ValueError(f'{campo}: ingresa un valor entre 0 y 2.147.483.647.')
        return n

    venc = data.get('vencimiento') or None
    if venc:
        try:
            venc = date.fromisoformat(str(venc))
        except ValueError:
            raise ValueError('La fecha de vencimiento no es válida.')
    categoria_id = data.get('categoria_id') or None
    if categoria_id is not None:
        try:
            categoria_id = int(categoria_id)
        except (ValueError, TypeError):
            raise ValueError('Selecciona un tipo de producto válido.')
        if not Categoria.objects.filter(pk=categoria_id).exists():
            raise ValueError('Ese tipo de producto no existe.')
    return {'codigo': codigo, 'nombre': nombre,
            'precio': entero(data.get('precio'), 'Precio'),
            'stock': entero(data.get('stock'), 'Cantidad'), 'vencimiento': venc,
            'categoria_id': categoria_id}


@require_http_methods(['GET', 'POST'])
def productos(request):
    ver_archivados = request.method == 'GET' and request.GET.get('archivados') == '1'
    fallo = acceso(request, admin=request.method != 'GET' or ver_archivados)
    if fallo is not None:
        return fallo
    if request.method == 'GET':
        q = request.GET.get('q', '').strip()[:100]
        qs = Producto.objects.filter(activo=not ver_archivados).select_related('categoria').order_by('nombre', 'id')
        if q:
            qs = qs.filter(Q(nombre__icontains=q) | Q(codigo__icontains=q) | Q(categoria__nombre__icontains=q))
        items = [serializar_producto(p) for p in qs]
        return JsonResponse({'productos': items, 'total': len(items)})
    data = datos_peticion(request)
    if data is None:
        return error('Solicitud inválida.')
    try:
        campos = datos_producto(data)
        imagen = validar_imagen(request)
        existente = Producto.objects.filter(codigo__iexact=campos['codigo']).first()
        if existente is not None:
            if not existente.activo:
                return error('Ese código pertenece a un producto archivado. Ve a Archivados para recuperarlo.', 409)
            return error('Ya hay un producto con ese código.', 409)
        if imagen:
            campos['imagen'] = imagen
        with transaction.atomic():
            p = Producto.objects.create(**campos)
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('Ese código ya está registrado.', 409)
    return JsonResponse({'producto': serializar_producto(Producto.objects.select_related('categoria').get(pk=p.pk))}, status=201)


@require_http_methods(['PUT', 'POST', 'DELETE'])
def producto_detalle(request, pk):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    try:
        p = Producto.objects.select_related('categoria').get(pk=pk)
    except Producto.DoesNotExist:
        return error('Este producto ya no existe.', 404)
    if request.method == 'DELETE':
        with transaction.atomic():
            actualizado = Producto.objects.filter(pk=p.pk, activo=True).update(activo=False)
        if not actualizado:
            return error('El producto ya estaba retirado del catálogo.', 409)
        return JsonResponse({'ok': True, 'archivado': True})
    data = datos_peticion(request)
    if data is None:
        return error('Solicitud inválida.')
    if data.get('restaurar') is True:
        if p.activo:
            return error('El producto ya está disponible.', 409)
        p.activo = True
        p.save(update_fields=['activo'])
        return JsonResponse({'producto': serializar_producto(p), 'restaurado': True})
    if not p.activo:
        return error('Este producto está archivado. Recupéralo antes de editarlo.', 409)
    try:
        campos = datos_producto(data)
        imagen = validar_imagen(request)
        quitar = str(data.get('quitar_imagen', '')).lower() in ('true', '1', 'si')
        if Producto.objects.filter(codigo__iexact=campos['codigo']).exclude(pk=pk).exists():
            return error('Ya hay un producto con ese código.', 409)
        with transaction.atomic():
            anterior = p.imagen.name if p.imagen else ''
            for nombre, valor in campos.items():
                setattr(p, nombre, valor)
            if imagen:
                p.imagen = imagen
            elif quitar:
                p.imagen = None
            p.save()
            if anterior and (imagen or quitar):
                quitar_imagen_anterior(anterior)
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('Ese código ya está registrado.', 409)
    p.refresh_from_db()
    return JsonResponse({'producto': serializar_producto(p)})


def validar_cuenta(datos, editando=False, user=None):
    username = str(datos.get('usuario', '')).strip()
    nombre = str(datos.get('nombre', '')).strip()
    rol = datos.get('rol')
    activo = datos.get('activo', True)
    password = datos.get('clave', '')
    if not 3 <= len(username) <= 150 or not re.fullmatch(r'[\w.@+-]+', username, flags=re.UNICODE):
        raise ValueError('El usuario debe tener 3 a 150 caracteres, sin espacios.')
    if not 2 <= len(nombre) <= 100:
        raise ValueError('Escribe el nombre de la persona (2 a 100 caracteres).')
    if rol not in ('Administrador', 'Cajero'):
        raise ValueError('Elige Administrador o Cajero.')
    if not isinstance(activo, bool):
        raise ValueError('Estado de usuario inválido.')
    if not isinstance(password, str):
        raise ValueError('La contraseña no es válida.')
    if not editando and not password:
        raise ValueError('Ingresa una contraseña para el nuevo usuario.')
    User = get_user_model()
    if User.objects.filter(username__iexact=username).exclude(pk=user.pk if user else None).exists():
        raise ValueError('Este nombre de usuario ya está ocupado.')
    if password:
        candidato = user or User(username=username, first_name=nombre)
        candidato.username = username
        try:
            validate_password(password, user=candidato)
        except ValidationError as exc:
            raise ValueError(' '.join(exc.messages))
    return username, nombre, rol, activo, password


@require_http_methods(['GET', 'POST'])
def usuarios(request):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    User = get_user_model()
    if request.method == 'GET':
        cuentas = User.objects.all().select_related('foto_perfil').prefetch_related('groups').order_by('username')
        return JsonResponse({'usuarios': [perfil(u, request.user) for u in cuentas]})
    try:
        datos = datos_cuenta(request)
        if datos is None:
            return error('Solicitud inválida.')
        foto, quitar = preparar_foto_perfil(request)
        username, nombre, rol, activo, clave = validar_cuenta(datos)
        with transaction.atomic():
            u = User.objects.create_user(username=username, password=clave, first_name=nombre, is_active=activo)
            grupo, _ = Group.objects.get_or_create(name=rol)
            u.groups.add(grupo)
            guardar_foto_perfil(u, foto, quitar)
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('El usuario ya existe.', 409)
    return JsonResponse({'usuario': perfil(u, request.user)}, status=201)


@require_http_methods(['PUT', 'POST'])
def usuario_detalle(request, pk):
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    User = get_user_model()
    try:
        data = datos_cuenta(request)
        if data is None:
            return error('Solicitud inválida.')
        foto, quitar = preparar_foto_perfil(request)
        with transaction.atomic():
            u = User.objects.select_for_update().get(pk=pk)
            # La cuenta principal puede editar sus propios datos desde Merqia,
            # pero otro administrador no puede modificarla.
            if u.is_superuser and u.pk != request.user.pk:
                return error('Solo la persona dueña de la cuenta principal puede modificarla.', 403)
            username, nombre, rol, activo, clave = validar_cuenta(data, editando=True, user=u)
            if u.pk == request.user.pk and (not activo or rol != 'Administrador'):
                return error('No puedes desactivar tu propia cuenta ni quitarte el acceso de administrador.', 400)
            if rol != 'Administrador' or not activo:
                otros_admin = User.objects.filter(is_active=True).filter(
                    Q(is_superuser=True) | Q(groups__name='Administrador')
                ).exclude(pk=u.pk).distinct().exists()
                if not otros_admin:
                    return error('Debe quedar al menos un administrador activo.', 400)
            u.username = username
            u.first_name = nombre
            u.last_name = ''
            u.is_active = activo
            if clave:
                u.set_password(clave)
            u.save()
            grupo, _ = Group.objects.get_or_create(name=rol)
            u.groups.set([grupo])
            guardar_foto_perfil(u, foto, quitar)
            if u.pk == request.user.pk and clave:
                update_session_auth_hash(request, u)
    except User.DoesNotExist:
        return error('Este usuario ya no existe.', 404)
    except ValueError as exc:
        return error(str(exc))
    except IntegrityError:
        return error('Ese nombre de usuario ya está ocupado.', 409)
    return JsonResponse({'usuario': perfil(u, request.user)})


@require_http_methods(['POST'])
def cambiar_estado_usuario(request, pk):
    """Suspender/reanudar acceso sin borrar datos o modificar privilegios de la cuenta."""
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None or not isinstance(datos.get('activo'), bool):
        return error('Indica si la cuenta debe quedar activa o inactiva.')
    User = get_user_model()
    try:
        with transaction.atomic():
            u = User.objects.select_for_update().get(pk=pk)
            if u.pk == request.user.pk:
                return error('No puedes suspender tu propia cuenta.', 400)
            if u.is_superuser:
                return error('La cuenta principal está protegida.', 403)
            activo = datos['activo']
            if not activo and rol_usuario(u) == 'Administrador' and u.is_active:
                existe_otro = User.objects.filter(is_active=True).filter(
                    Q(is_superuser=True) | Q(groups__name='Administrador')
                ).exclude(pk=u.pk).distinct().exists()
                if not existe_otro:
                    return error('Debe permanecer al menos un administrador activo.', 400)
            u.is_active = activo
            u.save(update_fields=['is_active'])
    except User.DoesNotExist:
        return error('La cuenta no existe.', 404)
    return JsonResponse({'usuario': perfil(u, request.user)})


@require_http_methods(['POST'])
def restablecer_clave_usuario(request, pk):
    """Restablece contraseñas con los validadores de Django; jamás devuelve claves."""
    fallo = acceso(request, admin=True)
    if fallo is not None:
        return fallo
    datos = leer_json(request)
    if datos is None or not isinstance(datos.get('clave'), str):
        return error('Escribe una contraseña nueva.')
    User = get_user_model()
    try:
        with transaction.atomic():
            u = User.objects.select_for_update().get(pk=pk)
            if u.is_superuser and u.pk != request.user.pk:
                return error('La cuenta principal solo puede cambiar su propia contraseña.', 403)
            if u.pk == request.user.pk:
                if not isinstance(datos.get('clave_actual'), str) or not u.check_password(datos['clave_actual']):
                    return error('Tu contraseña actual no es correcta.', 400)
            nueva = datos['clave']
            try:
                validate_password(nueva, user=u)
            except ValidationError as exc:
                return error(' '.join(exc.messages))
            if u.check_password(nueva):
                return error('La contraseña nueva debe ser diferente de la anterior.')
            u.set_password(nueva)
            u.save(update_fields=['password'])
            if u.pk == request.user.pk:
                update_session_auth_hash(request, u)
    except User.DoesNotExist:
        return error('La cuenta no existe.', 404)
    return JsonResponse({'ok': True, 'mensaje': 'Contraseña actualizada. La persona puede ingresar con su nueva clave.'})
