"""Panel técnico opcional; las tareas habituales se hacen desde Merqia."""
from django.contrib import admin
from .models import Producto, Categoria, Caja, Venta, DetalleVenta

admin.site.site_header = 'Merqia · Administración'
admin.site.site_title = 'Merqia'
admin.site.index_title = 'Configuración avanzada'


@admin.register(Categoria)
class CategoriaAdmin(admin.ModelAdmin):
    search_fields = ('nombre',)
    list_display = ('nombre',)


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'categoria', 'codigo', 'precio', 'stock', 'vencimiento')
    search_fields = ('nombre', 'codigo', 'categoria__nombre')
    list_filter = ('categoria', 'vencimiento')
    list_per_page = 30
    ordering = ('nombre',)


@admin.register(Caja)
class CajaAdmin(admin.ModelAdmin):
    list_display = ('id', 'usuario', 'fecha_apertura', 'fecha_cierre', 'monto_inicial')
    list_select_related = ('usuario',)


@admin.register(Venta)
class VentaAdmin(admin.ModelAdmin):
    list_display = ('id', 'fecha_hora', 'usuario', 'total', 'metodo_pago')
    list_select_related = ('usuario',)


@admin.register(DetalleVenta)
class DetalleVentaAdmin(admin.ModelAdmin):
    list_display = ('venta', 'producto', 'cantidad', 'subtotal')
    list_select_related = ('venta', 'producto')
