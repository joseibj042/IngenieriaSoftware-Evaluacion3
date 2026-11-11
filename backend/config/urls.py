from django.contrib import admin
from django.urls import path
from django.views.generic import TemplateView
from django.conf import settings
from django.conf.urls.static import static
from negocio import views, comercio

urlpatterns = [
    path('', TemplateView.as_view(template_name='nexo/index.html'), name='nexo_inicio'),
    path('admin/', admin.site.urls),
    path('api/csrf/', views.csrf, name='csrf'),
    path('api/comercio/estado/', comercio.estado, name='comercio_estado'),
    path('api/comercio/abrir/', comercio.abrir_caja, name='abrir_caja'),
    path('api/comercio/venta/', comercio.crear_venta, name='crear_venta'),
    path('api/comercio/movimiento/', comercio.registrar_movimiento, name='movimiento'),
    path('api/comercio/cerrar/', comercio.cerrar_caja, name='cerrar_caja'),
    path('api/comercio/ventas/', comercio.listar_ventas, name='listar_ventas'),
    path('api/comercio/configuracion/', comercio.guardar_configuracion, name='guardar_configuracion'),
    path('api/comercio/respaldo/', comercio.descargar_respaldo, name='descargar_respaldo'),
    path('api/login/', views.iniciar_sesion, name='login'),
    path('api/logout/', views.cerrar_sesion, name='logout'),
    path('api/session/', views.sesion_actual, name='session'),
    path('api/mi-foto/', views.mi_foto, name='mi_foto'),
    path('api/resumen/', views.resumen, name='resumen'),
    path('api/usuarios/', views.usuarios, name='usuarios'),
    path('api/usuarios/<int:pk>/', views.usuario_detalle, name='usuario_detalle'),
    path('api/usuarios/<int:pk>/estado/', views.cambiar_estado_usuario, name='usuario_estado'),
    path('api/usuarios/<int:pk>/clave/', views.restablecer_clave_usuario, name='usuario_clave'),
    path('api/categorias/', views.categorias, name='categorias'),
    path('api/categorias/<int:pk>/', views.categoria_detalle, name='categoria_detalle'),
    path('api/productos/', views.productos, name='productos'),
    path('api/productos/<int:pk>/', views.producto_detalle, name='producto_detalle'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
