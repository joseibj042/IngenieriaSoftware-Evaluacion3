from django.conf import settings
from django.db import models
from django.db.models import Q


class Categoria(models.Model):
    nombre = models.CharField(max_length=60, unique=True)

    class Meta:
        ordering = ['nombre']
        verbose_name = 'Categoría'
        verbose_name_plural = 'Categorías'

    def __str__(self):
        return self.nombre


class Producto(models.Model):
    codigo = models.CharField(max_length=40, unique=True)
    nombre = models.CharField(max_length=140)
    precio = models.PositiveIntegerField(help_text='Precio en pesos chilenos')
    stock = models.PositiveIntegerField(default=0)
    vencimiento = models.DateField(null=True, blank=True)
    categoria = models.ForeignKey(Categoria, on_delete=models.SET_NULL, null=True, blank=True, related_name='productos')
    imagen = models.ImageField(upload_to='productos/', null=True, blank=True)
    activo = models.BooleanField(default=True, db_index=True)


    class Meta:
        ordering = ['nombre']
        verbose_name_plural = 'Productos'

    def __str__(self):
        return f'{self.codigo} - {self.nombre}'


# Registro de turnos, ventas y movimientos de caja.
class Caja(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    fecha_apertura = models.DateTimeField(auto_now_add=True)
    fecha_cierre = models.DateTimeField(null=True, blank=True)
    monto_inicial = models.PositiveIntegerField(default=0)
    monto_final = models.PositiveIntegerField(null=True, blank=True, help_text='Saldo esperado en efectivo')
    monto_contado = models.PositiveIntegerField(null=True, blank=True)
    diferencia = models.IntegerField(null=True, blank=True)
    puesto = models.PositiveSmallIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['puesto'], condition=Q(fecha_cierre__isnull=True), name='solo_una_caja_abierta')
        ]

    def __str__(self):
        return f'Caja {self.pk}'


class Venta(models.Model):
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    caja = models.ForeignKey(Caja, on_delete=models.PROTECT, null=True, blank=True)
    fecha_hora = models.DateTimeField(auto_now_add=True)
    total = models.PositiveIntegerField(default=0)
    metodo_pago = models.CharField(max_length=20, choices=[('efectivo', 'Efectivo'), ('tarjeta', 'Tarjeta')])
    monto_recibido = models.PositiveIntegerField(default=0)
    vuelto = models.PositiveIntegerField(default=0)
    token_operacion = models.CharField(max_length=64, unique=True, null=True, blank=True, help_text='Previene ventas duplicadas al reintentar')

    def __str__(self):
        return f'Venta {self.pk}'


class DetalleVenta(models.Model):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name='detalles')
    producto = models.ForeignKey(Producto, on_delete=models.PROTECT)
    cantidad = models.PositiveIntegerField()
    precio_unitario = models.PositiveIntegerField()
    subtotal = models.PositiveIntegerField()
    nombre_producto = models.CharField(max_length=140, blank=True, default='')
    codigo_producto = models.CharField(max_length=40, blank=True, default='')

    class Meta:
        verbose_name = 'Detalle de venta'
        verbose_name_plural = 'Detalles de venta'


class MovimientoCaja(models.Model):
    TIPOS = [('ingreso', 'Ingreso de efectivo'), ('retiro', 'Retiro de efectivo')]
    caja = models.ForeignKey(Caja, on_delete=models.PROTECT, related_name='movimientos')
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    tipo = models.CharField(max_length=10, choices=TIPOS)
    monto = models.PositiveIntegerField()
    motivo = models.CharField(max_length=200)
    fecha_hora = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-fecha_hora', '-pk']


class ConfiguracionComercio(models.Model):
    # Una sola configuración para este local (ID fijo = 1).
    dias_alerta = models.PositiveSmallIntegerField(default=7)

    def __str__(self):
        return 'Preferencias del local'


class FotoPerfil(models.Model):
    usuario = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='foto_perfil')
    imagen = models.ImageField(upload_to='perfiles/')
