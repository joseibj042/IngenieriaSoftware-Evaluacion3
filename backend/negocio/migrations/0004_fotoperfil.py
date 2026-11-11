from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('negocio', '0003_configuracioncomercio_movimientocaja_caja_diferencia_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='FotoPerfil',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('imagen', models.ImageField(upload_to='perfiles/')),
                ('usuario', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='foto_perfil', to=settings.AUTH_USER_MODEL)),
            ],
        ),
    ]
