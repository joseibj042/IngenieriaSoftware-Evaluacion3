"""Configuración LOCAL y EDUCATIVA. No publicar así en producción."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'django-inseguro-solo-prototipo-local-cambiar-antes-de-publicar-2026'
DEBUG = True
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']
CSRF_TRUSTED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'negocio',
]
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'config.urls'
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]
WSGI_APPLICATION = 'config.wsgi.application'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
LANGUAGE_CODE = 'es-cl'
TIME_ZONE = 'America/Santiago'
USE_I18N = True
USE_TZ = True
STATIC_URL = '/static/'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# Fotografías locales de productos; no dependen de internet.
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Respaldos SQLite locales fuera de MEDIA; nunca servirlos como archivos públicos.
RESPALDOS_DIR = BASE_DIR / 'respaldos'
SESSION_COOKIE_AGE = 8 * 60 * 60
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
FILE_UPLOAD_MAX_MEMORY_SIZE = 3 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# Merqia compilado: Django muestra el frontend sin un servidor Vite abierto.
# Vite genera estos archivos con: cd frontend && npm run build
NEXO_BUILD_DIR = BASE_DIR / 'static_build'
TEMPLATES[0]['DIRS'].append(NEXO_BUILD_DIR)
# La carpeta aparece después de la primera compilación.
if NEXO_BUILD_DIR.is_dir():
    STATICFILES_DIRS = [NEXO_BUILD_DIR]
