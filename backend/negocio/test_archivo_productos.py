import json
from django.contrib.auth.models import Group, User
from django.test import TestCase
from .models import Categoria, Caja, DetalleVenta, Producto, Venta


class ArchivoProductosTests(TestCase):
    def setUp(self):
        admin = Group.objects.create(name='Administrador')
        cajero = Group.objects.create(name='Cajero')
        self.administrador = User.objects.create_user('admin_archivo', password='PruebaSegura!123')
        self.cajero = User.objects.create_user('cajero_archivo', password='PruebaSegura!123')
        self.administrador.groups.add(admin)
        self.cajero.groups.add(cajero)
        self.categoria = Categoria.objects.create(nombre='Aceites')
        self.producto = Producto.objects.create(codigo='P-ARCH', nombre='Aceite 900 ml', precio=1900, stock=0, categoria=self.categoria)
        self.venta = Venta.objects.create(usuario=self.cajero, total=1900, metodo_pago='efectivo', monto_recibido=2000, vuelto=100)
        self.detalle = DetalleVenta.objects.create(venta=self.venta, producto=self.producto, cantidad=1, precio_unitario=1900, subtotal=1900, nombre_producto='Aceite 900 ml', codigo_producto='P-ARCH')
        self.client.force_login(self.administrador)

    def test_se_puede_retirar_producto_ya_vendido_sin_borrar_historial(self):
        respuesta = self.client.delete(f'/api/productos/{self.producto.pk}/')
        self.assertEqual(respuesta.status_code, 200)
        self.assertTrue(respuesta.json()['archivado'])
        self.producto.refresh_from_db()
        self.assertFalse(self.producto.activo)
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(DetalleVenta.objects.get(pk=self.detalle.pk).producto_id, self.producto.pk)

    def test_archivado_no_aparece_en_inventario_ni_resumen(self):
        self.client.delete(f'/api/productos/{self.producto.pk}/')
        self.assertEqual(self.client.get('/api/productos/').json()['total'], 0)
        self.assertEqual(self.client.get('/api/resumen/').json()['productos'], 0)
        self.assertEqual(self.client.get('/api/categorias/').json()['categorias'][0]['productos'], 0)
        archivo = self.client.get('/api/productos/?archivados=1')
        self.assertEqual(archivo.status_code, 200)
        self.assertEqual(archivo.json()['productos'][0]['id'], self.producto.pk)

    def test_se_puede_recuperar_producto_archivado(self):
        self.client.delete(f'/api/productos/{self.producto.pk}/')
        respuesta = self.client.put(f'/api/productos/{self.producto.pk}/', data=json.dumps({'restaurar': True}), content_type='application/json')
        self.assertEqual(respuesta.status_code, 200)
        self.producto.refresh_from_db()
        self.assertTrue(self.producto.activo)
        self.assertEqual(self.client.get('/api/productos/').json()['total'], 1)
        self.assertEqual(Venta.objects.count(), 1)

    def test_cajero_no_puede_ver_archivados_ni_retirar(self):
        self.client.force_login(self.cajero)
        self.assertEqual(self.client.get('/api/productos/?archivados=1').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/productos/{self.producto.pk}/').status_code, 403)
        self.assertTrue(Producto.objects.get(pk=self.producto.pk).activo)

    def test_el_archivado_no_puede_venderse_aunque_se_envie_su_id(self):
        self.producto.stock = 3
        self.producto.save(update_fields=['stock'])
        Caja.objects.create(usuario=self.administrador, monto_inicial=5000)
        self.client.delete(f'/api/productos/{self.producto.pk}/')
        self.client.force_login(self.cajero)
        respuesta = self.client.post('/api/comercio/venta/', data=json.dumps({
            'items': [{'producto_id': self.producto.pk, 'cantidad': 1}],
            'metodo_pago': 'efectivo', 'monto_recibido': 2000,
            'token': '88c7d2ee-789a-4f10-9470-8fc8b403bc97',
        }), content_type='application/json')
        self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(Venta.objects.count(), 1)
        self.producto.refresh_from_db()
        self.assertEqual(self.producto.stock, 3)

    def test_no_puede_crear_otro_con_el_mismo_codigo_archivado(self):
        self.client.delete(f'/api/productos/{self.producto.pk}/')
        respuesta = self.client.post('/api/productos/', data=json.dumps({
            'codigo': 'P-ARCH', 'nombre': 'Aceite nuevo', 'precio': 2100, 'stock': 10,
        }), content_type='application/json')
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('archivado', respuesta.json()['error'])
