from datetime import date, timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group
from negocio.models import Categoria, Producto


class Command(BaseCommand):
    help = 'Crea roles y productos de ejemplo SIN usuarios/contraseñas predefinidos'

    def handle(self, *args, **options):
        for nombre in ['Administrador', 'Cajero']:
            Group.objects.get_or_create(name=nombre)
        nombres_categorias = ['Abarrotes', 'Bebidas', 'Lácteos', 'Panadería', 'Limpieza', 'Higiene', 'Congelados']
        tipos = {nombre: Categoria.objects.get_or_create(nombre=nombre)[0] for nombre in nombres_categorias}
        ejemplos = [
            ('7800000000011', 'Leche entera 1 L', 1250, 18, 5, 'Lácteos'),
            ('7800000000028', 'Pan de molde', 1990, 8, 4, 'Panadería'),
            ('7800000000035', 'Arroz 1 kg', 1690, 24, None, 'Abarrotes'),
            ('7800000000042', 'Yogur natural', 590, 3, 3, 'Lácteos'),
            ('7800000000059', 'Aceite 900 ml', 2790, 15, None, 'Abarrotes'),
            ('7800000000066', 'Queso laminado', 2990, 4, 6, 'Lácteos'),
        ]
        for codigo, nombre, precio, stock, dias, tipo in ejemplos:
            producto, _ = Producto.objects.get_or_create(
                codigo=codigo,
                defaults={'nombre': nombre, 'precio': precio, 'stock': stock,
                          'vencimiento': date.today() + timedelta(days=dias) if dias is not None else None, 'categoria': tipos[tipo]},
            )
            if producto.categoria_id is None:
                producto.categoria = tipos[tipo]
                producto.save(update_fields=['categoria'])
        self.stdout.write(self.style.SUCCESS('Roles, categorías y productos de ejemplo preparados.'))
