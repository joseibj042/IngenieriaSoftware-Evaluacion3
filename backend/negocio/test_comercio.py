"""Pruebas de operaciones críticas: ventas, stock, caja, roles y CSRF."""
import json
from datetime import timedelta
from django.contrib.auth.models import Group, User
from django.test import Client, TestCase
from django.utils import timezone
from .models import Caja, ConfiguracionComercio, DetalleVenta, MovimientoCaja, Producto, Venta


class ComercioTests(TestCase):
    def setUp(self):
        grupo_admin = Group.objects.create(name='Administrador')
        grupo_cajero = Group.objects.create(name='Cajero')
        self.admin = User.objects.create_user('encargado3', password='ClaveSegura!123')
        self.cajero = User.objects.create_user('cajero3', password='ClaveSegura!123')
        self.admin.groups.add(grupo_admin)
        self.cajero.groups.add(grupo_cajero)
        self.arroz = Producto.objects.create(codigo='AR-01', nombre='Arroz', precio=1200, stock=12)
        self.leche = Producto.objects.create(codigo='LE-01', nombre='Leche', precio=1000, stock=4)
        self.client.force_login(self.cajero)

    def post(self, ruta, datos):
        return self.client.post(ruta, data=json.dumps(datos), content_type='application/json')

    def venta(self, items=None, pago='efectivo', recibido=5000, token='01234567-89ab-4cde-a012-3456789abcde'):
        return self.post('/api/comercio/venta/', {
            'items': items if items is not None else [{'producto_id':self.arroz.id,'cantidad':2}],
            'metodo_pago':pago, 'monto_recibido':recibido, 'token':token,
        })

    def abrir(self, inicial=10000):
        return self.post('/api/comercio/abrir/', {'monto_inicial':inicial})

    def test_no_vende_sin_caja_abierta(self):
        r = self.venta()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(Venta.objects.count(), 0)
        self.arroz.refresh_from_db()
        self.assertEqual(self.arroz.stock, 12)

    def test_apertura_y_venta_efectivo_descuenta_stock(self):
        self.assertEqual(self.abrir().status_code, 201)
        r = self.venta()
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()['venta']['total'], 2400)
        self.assertEqual(r.json()['venta']['vuelto'], 2600)
        self.assertEqual(DetalleVenta.objects.count(), 1)
        self.arroz.refresh_from_db()
        self.assertEqual(self.arroz.stock, 10)
        self.assertEqual(self.client.get('/api/comercio/estado/').json()['caja']['saldo_esperado'], 12400)

    def test_no_duplica_venta_reintentando_el_mismo_token(self):
        self.abrir()
        a = self.venta()
        b = self.venta()
        self.assertEqual(a.status_code, 201)
        self.assertEqual(b.status_code, 200)
        self.assertTrue(b.json()['repetida'])
        self.assertEqual(Venta.objects.count(), 1)
        self.arroz.refresh_from_db()
        self.assertEqual(self.arroz.stock, 10)

    def test_no_vende_mas_stock_ni_deja_ventas_parciales(self):
        self.abrir()
        r = self.venta(items=[{'producto_id':self.arroz.id,'cantidad':2}, {'producto_id':self.leche.id,'cantidad':5}])
        self.assertEqual(r.status_code, 409)
        self.arroz.refresh_from_db()
        self.leche.refresh_from_db()
        self.assertEqual((self.arroz.stock, self.leche.stock), (12,4))
        self.assertEqual(Venta.objects.count(), 0)

    def test_vuelto_insuficiente_se_rechaza(self):
        self.abrir()
        self.assertEqual(self.venta(recibido=2000).status_code, 400)
        self.assertEqual(Venta.objects.count(), 0)

    def test_pago_tarjeta_no_incrementa_efectivo(self):
        self.abrir()
        r = self.venta(pago='tarjeta', recibido=0)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.get('/api/comercio/estado/').json()['caja']['saldo_esperado'],10000)
        self.assertEqual(Venta.objects.get().total,2400)
        self.assertEqual(Venta.objects.get().monto_recibido,0)

    def test_precio_y_total_se_calculan_en_servidor(self):
        self.abrir()
        r = self.post('/api/comercio/venta/', {'items':[{'producto_id':self.arroz.id,'cantidad':1,'precio':1}],
            'total':1,'metodo_pago':'efectivo','monto_recibido':2000,'token':'11234567-89ab-4cde-a012-3456789abcde'})
        self.assertEqual(r.json()['venta']['total'],1200)

    def test_rechaza_vencidos(self):
        self.abrir()
        self.arroz.vencimiento = timezone.localdate()-timedelta(days=1)
        self.arroz.save(update_fields=['vencimiento'])
        self.assertEqual(self.venta().status_code, 409)

    def test_abrir_dos_cajas_se_rechaza(self):
        self.assertEqual(self.abrir().status_code, 201)
        self.assertEqual(self.abrir().status_code, 409)
        self.assertEqual(Caja.objects.count(), 1)

    def test_movimiento_y_cuadratura(self):
        self.abrir()
        self.venta()
        ingreso=self.post('/api/comercio/movimiento/', {'tipo':'ingreso','monto':500,'motivo':'Cambio de turno'})
        self.assertEqual(ingreso.status_code,201)
        retiro=self.post('/api/comercio/movimiento/', {'tipo':'retiro','monto':600,'motivo':'Pago insumos'})
        self.assertEqual(retiro.status_code,201)
        self.assertEqual(MovimientoCaja.objects.count(), 2)
        self.assertEqual(self.client.get('/api/comercio/estado/').json()['caja']['saldo_esperado'], 12300)
        cerrado=self.post('/api/comercio/cerrar/', {'monto_contado': 12200})
        self.assertEqual(cerrado.status_code,200)
        self.assertEqual(cerrado.json()['caja']['diferencia'],-100)
        self.assertIsNotNone(Caja.objects.get().fecha_cierre)
        self.assertEqual(self.venta(token='11234567-89ab-4cde-a012-3456789abcde').status_code,409)

    def test_retiro_no_puede_superar_saldo(self):
        self.abrir(100)
        r = self.post('/api/comercio/movimiento/', {'tipo':'retiro','monto':200,'motivo':'Pago de insumos'})
        self.assertEqual(r.status_code,409)
        self.assertEqual(MovimientoCaja.objects.count(),0)

    def test_vuelve_a_abrir_tras_cerrar_el_turno(self):
        self.abrir()
        self.post('/api/comercio/cerrar/',{'monto_contado':10000})
        self.assertEqual(self.abrir(5000).status_code,201)
        self.assertEqual(Caja.objects.count(),2)

    def test_cajero_no_cambia_avisos_ni_descarga_respaldo(self):
        r=self.client.put('/api/comercio/configuracion/',json.dumps({'dias_alerta':30}),content_type='application/json')
        self.assertEqual(r.status_code,403)
        self.assertEqual(self.post('/api/comercio/respaldo/',{}).status_code,403)
        self.client.force_login(self.admin)
        r=self.client.put('/api/comercio/configuracion/',json.dumps({'dias_alerta':30}),content_type='application/json')
        self.assertEqual(r.status_code,200)
        self.assertEqual(ConfiguracionComercio.objects.get().dias_alerta,30)
        self.assertEqual(self.client.get('/api/resumen/').json()['dias_alerta'],30)

    def test_no_autorizado_no_puede_vender(self):
        self.abrir()
        self.client.logout()
        self.assertEqual(self.venta().status_code,401)

    def test_historial_empleado_solo_ve_sus_ventas(self):
        self.abrir()
        self.venta()
        self.client.force_login(self.admin)
        self.venta(token='11234567-89ab-4cde-a012-3456789abcde')
        self.client.force_login(self.cajero)
        self.assertEqual(len(self.client.get('/api/comercio/ventas/').json()['ventas']),1)
        self.client.force_login(self.admin)
        self.assertEqual(len(self.client.get('/api/comercio/ventas/').json()['ventas']),2)

    def test_validacion_cantidad_y_entrada_maliciosa(self):
        self.abrir()
        for items in [[{'producto_id':self.arroz.id,'cantidad':-1}], [{'producto_id':self.arroz.id,'cantidad':1.2}],
                      [{'producto_id':self.arroz.id,'cantidad':True}]]:
            self.assertIn(self.venta(items=items).status_code,(400,409))
        self.assertEqual(Venta.objects.count(),0)

    def test_csrf_real_bloquea_post_sin_token(self):
        cliente=Client(enforce_csrf_checks=True)
        cliente.force_login(self.cajero)
        r=cliente.post('/api/comercio/abrir/',json.dumps({'monto_inicial':100}),content_type='application/json')
        self.assertEqual(r.status_code,403)

