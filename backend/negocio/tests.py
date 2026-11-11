import json
from django.contrib.auth.models import User, Group
from django.test import Client, TestCase
from .models import Producto, Categoria


class Etapa2Tests(TestCase):
    def setUp(self):
        admin = Group.objects.create(name='Administrador')
        cajero = Group.objects.create(name='Cajero')
        self.encargado = User.objects.create_user(username='encargado', password='ClaveSegura!123')
        self.encargado.groups.add(admin)
        self.cajero = User.objects.create_user(username='cajero', password='ClaveSegura!123')
        self.cajero.groups.add(cajero)

    def login(self, nombre):
        return self.client.post('/api/login/',
                                data=json.dumps({'usuario': nombre, 'clave': 'ClaveSegura!123'}),
                                content_type='application/json')

    def test_login_autentica_usuario_almacenado(self):
        respuesta = self.login('cajero')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()['usuario']['rol'], 'Cajero')
        self.assertEqual(self.client.get('/api/session/').status_code, 200)

    def test_usuario_no_autenticado_no_puede_leer_productos(self):
        self.assertEqual(self.client.get('/api/productos/').status_code, 401)

    def test_cajero_no_puede_crear_productos(self):
        self.login('cajero')
        respuesta = self.client.post('/api/productos/',
                                    data=json.dumps({'codigo': 'P01', 'nombre': 'Arroz', 'precio': 1000, 'stock': 5}),
                                    content_type='application/json')
        self.assertEqual(respuesta.status_code, 403)
        self.assertEqual(Producto.objects.count(), 0)

    def test_admin_guarda_producto_en_sqlite(self):
        self.login('encargado')
        respuesta = self.client.post('/api/productos/',
                                    data=json.dumps({'codigo': 'P01', 'nombre': 'Arroz', 'precio': 1000, 'stock': 5}),
                                    content_type='application/json')
        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(Producto.objects.get(codigo='P01').nombre, 'Arroz')

    def test_proteccion_csrf_en_login(self):
        cliente = Client(enforce_csrf_checks=True)
        respuesta = cliente.get('/api/csrf/')
        token = respuesta.json()['csrfToken']
        sin_token = cliente.post('/api/login/',
                                data=json.dumps({'usuario': 'cajero', 'clave': 'ClaveSegura!123'}),
                                content_type='application/json')
        self.assertEqual(sin_token.status_code, 403)
        con_token = cliente.post('/api/login/',
                                data=json.dumps({'usuario': 'cajero', 'clave': 'ClaveSegura!123'}),
                                content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(con_token.status_code, 200)

    def test_directorio_de_usuarios_solo_administradores(self):
        self.login('cajero')
        self.assertEqual(self.client.get('/api/usuarios/').status_code, 403)
        self.login('encargado')
        respuesta = self.client.get('/api/usuarios/')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(len(respuesta.json()['usuarios']), 2)

    def test_usuario_sin_rol_no_accede_a_api(self):
        invitado = User.objects.create_user(username='sinrol', password='ClaveSegura!123')
        self.client.force_login(invitado)
        self.assertEqual(self.client.get('/api/productos/').status_code, 403)

    def test_admin_modifica_producto_y_resumen(self):
        self.login('encargado')
        nuevo = self.client.post('/api/productos/',
            data=json.dumps({'codigo': 'LECHE', 'nombre': 'Leche', 'precio': 1100, 'stock': 7}),
            content_type='application/json')
        self.assertEqual(nuevo.status_code, 201)
        pk = nuevo.json()['producto']['id']
        editar = self.client.put(f'/api/productos/{pk}/',
            data=json.dumps({'codigo': 'LECHE', 'nombre': 'Leche entera', 'precio': 1300, 'stock': 2}),
            content_type='application/json')
        self.assertEqual(editar.status_code, 200)
        self.assertEqual(Producto.objects.get(pk=pk).stock, 2)
        self.assertEqual(self.client.get('/api/resumen/').json()['stock_bajo'], 1)

    def test_busqueda_muestra_total_de_registros(self):
        self.login('encargado')
        Producto.objects.create(codigo='A01', nombre='Arroz integral', precio=1200, stock=3)
        Producto.objects.create(codigo='B01', nombre='Leche entera', precio=1000, stock=3)
        respuesta = self.client.get('/api/productos/?q=arroz')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()['total'], 1)
        self.assertEqual(respuesta.json()['productos'][0]['codigo'], 'A01')

    def test_superusuario_identificado_como_administrador(self):
        superior = User.objects.create_superuser(username='superior', password='ClaveSegura!123')
        self.client.force_login(superior)
        respuesta = self.client.get('/api/session/')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json()['usuario']['rol'], 'Administrador')
        self.assertTrue(respuesta.json()['usuario']['protegido'])


class GestionUsuariosTests(TestCase):
    def setUp(self):
        admin = Group.objects.create(name='Administrador')
        cajero = Group.objects.create(name='Cajero')
        self.administrador = User.objects.create_user(username='adminlocal', password='ClaveSegura!123')
        self.administrador.groups.add(admin)
        self.cajero = User.objects.create_user(username='cajerolocal', password='ClaveSegura!123')
        self.cajero.groups.add(cajero)
        self.client.force_login(self.administrador)

    def post_json(self, url, data):
        return self.client.post(url, data=json.dumps(data), content_type='application/json')

    def put_json(self, url, data):
        return self.client.put(url, data=json.dumps(data), content_type='application/json')

    def nuevo(self, **cambios):
        data = {'usuario': 'maria', 'nombre': 'María Soto', 'rol': 'Cajero', 'activo': True, 'clave': 'OtraClaveSegura!2026'}
        data.update(cambios)
        return data

    def test_admin_crea_persona_con_rol_y_password_hasheado(self):
        r = self.post_json('/api/usuarios/', self.nuevo())
        self.assertEqual(r.status_code, 201)
        creada = User.objects.get(username='maria')
        self.assertTrue(creada.check_password('OtraClaveSegura!2026'))
        self.assertNotEqual(creada.password, 'OtraClaveSegura!2026')
        self.assertTrue(creada.groups.filter(name='Cajero').exists())

    def test_cajero_no_puede_crear_ni_editar_usuarios(self):
        self.client.force_login(self.cajero)
        self.assertEqual(self.post_json('/api/usuarios/', self.nuevo()).status_code, 403)
        self.assertEqual(self.put_json(f'/api/usuarios/{self.administrador.pk}/', self.nuevo()).status_code, 403)

    def test_administrador_edita_cuenta_y_conserva_password_si_no_envia_nueva(self):
        usuario = User.objects.create_user(username='maria', password='OtraClaveSegura!2026')
        usuario.groups.add(Group.objects.get(name='Cajero'))
        data = self.nuevo(usuario='maria2', nombre='María actualizada', rol='Administrador', clave='')
        r = self.put_json(f'/api/usuarios/{usuario.pk}/', data)
        self.assertEqual(r.status_code, 200)
        usuario.refresh_from_db()
        self.assertEqual(usuario.username, 'maria2')
        self.assertTrue(usuario.check_password('OtraClaveSegura!2026'))
        self.assertTrue(usuario.groups.filter(name='Administrador').exists())

    def test_administrador_desactiva_usuario_sin_borrarlo(self):
        r = self.post_json('/api/usuarios/', self.nuevo())
        self.assertEqual(r.status_code, 201)
        pk = r.json()['usuario']['id']
        data = self.nuevo(clave='', activo=False)
        respuesta = self.put_json(f'/api/usuarios/{pk}/', data)
        self.assertEqual(respuesta.status_code, 200)
        self.assertFalse(User.objects.get(pk=pk).is_active)
        self.client.logout()
        login = self.post_json('/api/login/', {'usuario': 'maria', 'clave': 'OtraClaveSegura!2026'})
        self.assertEqual(login.status_code, 401)

    def test_no_puede_desactivar_su_propia_cuenta(self):
        data = self.nuevo(usuario='adminlocal', nombre='Mi Cuenta', rol='Administrador', activo=False, clave='')
        r = self.put_json(f'/api/usuarios/{self.administrador.pk}/', data)
        self.assertEqual(r.status_code, 400)
        self.administrador.refresh_from_db()
        self.assertTrue(self.administrador.is_active)

    def test_no_puede_modificar_superusuario_desde_api_cotidiana(self):
        superior = User.objects.create_superuser(username='rootlocal', password='ClaveSegura!123')
        data = self.nuevo(usuario='rootlocal', clave='')
        r = self.put_json(f'/api/usuarios/{superior.pk}/', data)
        self.assertEqual(r.status_code, 403)

    def test_no_permite_usuarios_repetidos_sin_distinguir_mayusculas(self):
        self.assertEqual(self.post_json('/api/usuarios/', self.nuevo()).status_code, 201)
        r = self.post_json('/api/usuarios/', self.nuevo(usuario='MARIA'))
        self.assertEqual(r.status_code, 400)

    def test_listado_de_productos_no_omite_los_que_superen_200(self):
        Producto.objects.bulk_create([
            Producto(codigo=f'C{i:03d}', nombre=f'Producto {i:03d}', precio=500, stock=2)
            for i in range(205)
        ])
        r = self.client.get('/api/productos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['productos']), 205)
        self.assertEqual(r.json()['total'], 205)


class CategoriasEImagenesTests(TestCase):
    """Pruebas de las funciones incorporadas al catálogo visual."""

    def setUp(self):
        import tempfile
        from django.test import override_settings
        self.temp = tempfile.TemporaryDirectory()
        self.configuracion = override_settings(MEDIA_ROOT=self.temp.name)
        self.configuracion.enable()
        self.addCleanup(self.configuracion.disable)
        self.addCleanup(self.temp.cleanup)
        admin = Group.objects.create(name='Administrador')
        cajero = Group.objects.create(name='Cajero')
        self.admin = User.objects.create_user(username='adminfoto', password='ClaveSegura!123')
        self.admin.groups.add(admin)
        self.cajero = User.objects.create_user(username='cajerofoto', password='ClaveSegura!123')
        self.cajero.groups.add(cajero)

    def json_post(self, ruta, datos):
        return self.client.post(ruta, json.dumps(datos), content_type='application/json')

    def json_put(self, ruta, datos):
        return self.client.put(ruta, json.dumps(datos), content_type='application/json')

    def datos(self, **cambios):
        base = {'nombre': 'Arroz 1 kg', 'codigo': 'A01', 'precio': 1500, 'stock': 10, 'categoria_id': ''}
        base.update(cambios)
        return base

    def foto(self):
        from io import BytesIO
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        imagen = Image.new('RGB', (20, 20), (120, 190, 130))
        memoria = BytesIO()
        imagen.save(memoria, format='PNG')
        return SimpleUploadedFile('arroz.png', memoria.getvalue(), content_type='image/png')

    def test_crear_categoria_y_buscar_producto_por_tipo(self):
        self.client.force_login(self.admin)
        respuesta = self.json_post('/api/categorias/', {'nombre': 'Abarrotes'})
        self.assertEqual(respuesta.status_code, 201)
        pk = respuesta.json()['categoria']['id']
        producto = self.json_post('/api/productos/', self.datos(categoria_id=pk))
        self.assertEqual(producto.status_code, 201)
        self.assertEqual(producto.json()['producto']['categoria'], 'Abarrotes')
        self.assertEqual(self.client.get('/api/productos/?q=abarrotes').json()['total'], 1)
        self.assertEqual(self.client.get('/api/categorias/').json()['categorias'][0]['productos'], 1)

    def test_cajero_no_puede_gestionar_categorias_ni_subir_foto(self):
        self.client.force_login(self.cajero)
        self.assertEqual(self.json_post('/api/categorias/', {'nombre': 'Lácteos'}).status_code, 403)
        respuesta = self.client.post('/api/productos/', data={**self.datos(), 'imagen': self.foto()})
        self.assertEqual(respuesta.status_code, 403)

    def test_tipo_duplicado_y_borrar_tipo_con_productos(self):
        self.client.force_login(self.admin)
        self.json_post('/api/categorias/', {'nombre': 'Lácteos'})
        self.assertEqual(self.json_post('/api/categorias/', {'nombre': 'lácteos'}).status_code, 409)
        categoria = Categoria.objects.get(nombre='Lácteos')
        self.json_post('/api/productos/', self.datos(categoria_id=categoria.pk))
        self.assertEqual(self.client.delete(f'/api/categorias/{categoria.pk}/').status_code, 409)
        self.assertEqual(self.json_put(f'/api/categorias/{categoria.pk}/', {'nombre': 'Lácteos fríos'}).status_code, 200)

    def test_subir_cambiar_y_quitar_imagen(self):
        from pathlib import Path
        self.client.force_login(self.admin)
        nuevo = self.client.post('/api/productos/', data={**self.datos(), 'imagen': self.foto()})
        self.assertEqual(nuevo.status_code, 201)
        pk = nuevo.json()['producto']['id']
        imagen = Producto.objects.get(pk=pk).imagen
        self.assertTrue(Path(imagen.path).exists())
        self.assertTrue(nuevo.json()['producto']['imagen'].startswith('/media/productos/'))
        editado = self.client.post(f'/api/productos/{pk}/', data={**self.datos(nombre='Arroz premium'), 'quitar_imagen': 'true'})
        self.assertEqual(editado.status_code, 200)
        self.assertIsNone(editado.json()['producto']['imagen'])
        self.assertEqual(Producto.objects.get(pk=pk).nombre, 'Arroz premium')

    def test_rechaza_archivos_que_no_son_imagenes(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        self.client.force_login(self.admin)
        imagen_falsa = SimpleUploadedFile('falso.png', b'Esto no es una imagen', content_type='image/png')
        respuesta = self.client.post('/api/productos/', data={**self.datos(), 'imagen': imagen_falsa})
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(Producto.objects.count(), 0)


class EquipoIntegralTests(TestCase):
    """Gestión cotidiana de personal sin pasar por la consola técnica de Django."""

    def setUp(self):
        self.admin_role = Group.objects.create(name='Administrador')
        self.cajero_role = Group.objects.create(name='Cajero')
        self.admin = User.objects.create_user(username='responsable', password='ClaveInicial#2026')
        self.admin.groups.add(self.admin_role)
        self.empleado = User.objects.create_user(username='valentina', first_name='Valentina Ruiz', password='ClaveEmpleado#2026')
        self.empleado.groups.add(self.cajero_role)
        self.client.force_login(self.admin)

    def enviar(self, url, data):
        return self.client.post(url, json.dumps(data), content_type='application/json')

    def editar(self, url, data):
        return self.client.put(url, json.dumps(data), content_type='application/json')

    def test_directorio_muestra_rol_estado_y_ultimo_ingreso_sin_exponer_password(self):
        resultado = self.client.get('/api/usuarios/')
        self.assertEqual(resultado.status_code, 200)
        cuentas = resultado.json()['usuarios']
        self.assertEqual(len(cuentas), 2)
        encontrada = next(x for x in cuentas if x['usuario'] == 'valentina')
        self.assertEqual(encontrada['rol'], 'Cajero')
        self.assertTrue(encontrada['activo'])
        self.assertIsNone(encontrada['ultimo_acceso'])
        self.assertIsNotNone(encontrada['creado_el'])
        self.assertNotIn('password', str(resultado.content).lower())
        self.assertNotIn('ClaveEmpleado#2026', str(resultado.content))

    def test_suspender_y_reactivar_acceso_sin_borrar_cuenta(self):
        url = f'/api/usuarios/{self.empleado.pk}/estado/'
        respuesta = self.enviar(url, {'activo': False})
        self.assertEqual(respuesta.status_code, 200)
        self.empleado.refresh_from_db()
        self.assertFalse(self.empleado.is_active)
        self.assertEqual(self.empleado.username, 'valentina')
        self.client.logout()
        intento = self.enviar('/api/login/', {'usuario': 'valentina', 'clave': 'ClaveEmpleado#2026'})
        self.assertEqual(intento.status_code, 401)
        self.client.force_login(self.admin)
        self.assertEqual(self.enviar(url, {'activo': True}).status_code, 200)
        self.client.logout()
        ingreso = self.enviar('/api/login/', {'usuario': 'valentina', 'clave': 'ClaveEmpleado#2026'})
        self.assertEqual(ingreso.status_code, 200)

    def test_suspension_rechaza_estado_invalido_o_de_su_propia_cuenta(self):
        self.assertEqual(self.enviar(f'/api/usuarios/{self.empleado.pk}/estado/', {'activo': 'no'}).status_code, 400)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.admin.pk}/estado/', {'activo': False}).status_code, 400)
        self.assertTrue(User.objects.get(pk=self.admin.pk).is_active)

    def test_admin_restablece_clave_sin_conocer_la_anterior(self):
        url = f'/api/usuarios/{self.empleado.pk}/clave/'
        respuesta = self.enviar(url, {'clave': 'OtraClaveFuerte#2026'})
        self.assertEqual(respuesta.status_code, 200)
        self.empleado.refresh_from_db()
        self.assertTrue(self.empleado.check_password('OtraClaveFuerte#2026'))
        self.assertFalse(self.empleado.check_password('ClaveEmpleado#2026'))
        self.assertNotIn('OtraClaveFuerte#2026', str(respuesta.content))

    def test_nueva_clave_debe_ser_distinta_y_segura(self):
        url = f'/api/usuarios/{self.empleado.pk}/clave/'
        self.assertEqual(self.enviar(url, {'clave': '123'}).status_code, 400)
        self.assertEqual(self.enviar(url, {'clave': 'ClaveEmpleado#2026'}).status_code, 400)
        self.assertTrue(User.objects.get(pk=self.empleado.pk).check_password('ClaveEmpleado#2026'))

    def test_una_persona_sin_permisos_no_puede_suspender_ni_cambiar_password(self):
        self.client.force_login(self.empleado)
        self.assertEqual(self.client.get('/api/usuarios/').status_code, 403)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.admin.pk}/estado/', {'activo': False}).status_code, 403)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.admin.pk}/clave/', {'clave': 'Insegura#2026'}).status_code, 403)

    def test_anonimo_no_puede_usar_gestion_de_equipo(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/usuarios/').status_code, 401)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.empleado.pk}/estado/', {'activo': False}).status_code, 401)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.empleado.pk}/clave/', {'clave': 'Insegura#2026'}).status_code, 401)

    def test_titular_de_cuenta_principal_edita_sus_datos_sin_abrir_admin(self):
        principal = User.objects.create_superuser(username='dueño', password='ClaveSuper#2026')
        self.client.force_login(principal)
        datos = {'usuario': 'propietario', 'nombre': 'Dueño Principal', 'rol': 'Administrador', 'activo': True, 'clave': ''}
        respuesta = self.editar(f'/api/usuarios/{principal.pk}/', datos)
        self.assertEqual(respuesta.status_code, 200)
        principal.refresh_from_db()
        self.assertEqual(principal.username, 'propietario')
        self.assertEqual(principal.first_name, 'Dueño Principal')
        self.assertTrue(principal.is_superuser)
        self.assertEqual(self.client.get('/api/session/').status_code, 200)

    def test_cuenta_principal_no_puede_quitarse_permisos(self):
        principal = User.objects.create_superuser(username='dueño', password='ClaveSuper#2026')
        self.client.force_login(principal)
        datos = {'usuario': 'dueño', 'nombre': 'Dueño', 'rol': 'Cajero', 'activo': True, 'clave': ''}
        self.assertEqual(self.editar(f'/api/usuarios/{principal.pk}/', datos).status_code, 400)
        self.assertEqual(self.enviar(f'/api/usuarios/{principal.pk}/estado/', {'activo': False}).status_code, 400)
        principal.refresh_from_db()
        self.assertTrue(principal.is_superuser)
        self.assertTrue(principal.is_active)

    def test_otro_admin_no_puede_cambiar_cuenta_principal(self):
        principal = User.objects.create_superuser(username='dueño', password='ClaveSuper#2026')
        self.assertEqual(self.enviar(f'/api/usuarios/{principal.pk}/estado/', {'activo': False}).status_code, 403)
        self.assertEqual(self.enviar(f'/api/usuarios/{principal.pk}/clave/', {'clave': 'OtraClaveSuper#2026'}).status_code, 403)

    def test_para_cambiar_su_clave_admin_debe_indicar_la_actual(self):
        url = f'/api/usuarios/{self.admin.pk}/clave/'
        self.assertEqual(self.enviar(url, {'clave': 'NuevaClave#2026', 'clave_actual': 'falsa'}).status_code, 400)
        self.assertEqual(self.enviar(url, {'clave': 'NuevaClave#2026', 'clave_actual': 'ClaveInicial#2026'}).status_code, 200)
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password('NuevaClave#2026'))
        self.assertEqual(self.client.get('/api/session/').status_code, 200)

    def test_restaurar_password_de_otro_usuario_invalida_sesion_anterior(self):
        empleado_cliente = Client()
        empleado_cliente.force_login(self.empleado)
        self.assertEqual(empleado_cliente.get('/api/session/').status_code, 200)
        self.assertEqual(self.enviar(f'/api/usuarios/{self.empleado.pk}/clave/', {'clave': 'NuevaClaveValentina#2026'}).status_code, 200)
        self.assertEqual(empleado_cliente.get('/api/session/').status_code, 401)

    def test_usuarios_inexistentes_devuelven_404(self):
        self.assertEqual(self.enviar('/api/usuarios/999999/estado/', {'activo': False}).status_code, 404)
        self.assertEqual(self.enviar('/api/usuarios/999999/clave/', {'clave': 'UnaClaveSegura#2026'}).status_code, 404)


class FotosDeEquipoTests(TestCase):
    def setUp(self):
        import tempfile
        from django.test import override_settings
        self.tempdir = tempfile.TemporaryDirectory()
        self.configuracion = override_settings(MEDIA_ROOT=self.tempdir.name)
        self.configuracion.enable()
        self.addCleanup(self.configuracion.disable)
        self.addCleanup(self.tempdir.cleanup)
        admin = Group.objects.create(name='Administrador')
        cajero = Group.objects.create(name='Cajero')
        self.jefe = User.objects.create_user('jefe_fotos', password='ClaveSegura!123')
        self.empleado = User.objects.create_user('empleado_fotos', password='ClaveSegura!123')
        self.jefe.groups.add(admin)
        self.empleado.groups.add(cajero)
        self.client.force_login(self.jefe)

    def foto(self):
        from io import BytesIO
        from PIL import Image
        from django.core.files.uploadedfile import SimpleUploadedFile
        buffer = BytesIO()
        Image.new('RGB', (180, 240), (55, 105, 155)).save(buffer, format='PNG')
        return SimpleUploadedFile('equipo.png', buffer.getvalue(), content_type='image/png')

    def datos(self, foto=None):
        datos = {'usuario': 'marisol', 'nombre': 'Marisol Valdés', 'rol': 'Cajero', 'activo': 'true', 'clave': 'OtraClaveSegura#2026'}
        if foto is not None:
            datos['foto'] = foto
        return datos

    def test_crear_usuario_con_foto_y_verla_en_equipo(self):
        r = self.client.post('/api/usuarios/', data=self.datos(self.foto()))
        self.assertEqual(r.status_code, 201, r.content)
        self.assertIn('/media/perfiles/', r.json()['usuario']['foto'])
        usuarios = self.client.get('/api/usuarios/').json()['usuarios']
        self.assertEqual(next(x for x in usuarios if x['usuario'] == 'marisol')['foto'], r.json()['usuario']['foto'])

    def test_actualizar_y_quitar_foto_conservando_cuenta(self):
        r = self.client.post('/api/usuarios/', data=self.datos())
        pk = r.json()['usuario']['id']
        datos = self.datos(self.foto())
        datos['clave'] = ''
        agregado = self.client.post(f'/api/usuarios/{pk}/', data=datos)
        self.assertEqual(agregado.status_code, 200, agregado.content)
        self.assertTrue(agregado.json()['usuario']['foto'])
        datos.pop('foto')
        datos['quitar_foto'] = 'true'
        quitado = self.client.post(f'/api/usuarios/{pk}/', data=datos)
        self.assertEqual(quitado.status_code, 200, quitado.content)
        self.assertIsNone(quitado.json()['usuario']['foto'])
        self.assertTrue(User.objects.get(pk=pk).check_password('OtraClaveSegura#2026'))

    def test_cajero_solo_puede_actualizar_su_foto(self):
        self.client.force_login(self.empleado)
        r = self.client.post('/api/mi-foto/', data={'foto': self.foto()})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertIn('/media/perfiles/', self.client.get('/api/session/').json()['usuario']['foto'])
        self.assertEqual(self.client.post(f'/api/usuarios/{self.jefe.pk}/', data=self.datos(self.foto())).status_code, 403)
        self.assertIsNone(self.jefe.foto_perfil.imagen.url if hasattr(self.jefe, 'foto_perfil') else None)
        eliminado = self.client.post('/api/mi-foto/', data={'quitar_foto': 'true'})
        self.assertEqual(eliminado.status_code, 200, eliminado.content)
        self.assertIsNone(eliminado.json()['usuario']['foto'])

    def test_rechaza_una_foto_falsa_y_no_crea_cuenta(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        falsa = SimpleUploadedFile('falsa.png', b'este archivo no es una foto', content_type='image/png')
        r = self.client.post('/api/usuarios/', data=self.datos(falsa))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(User.objects.filter(username='marisol').exists())
