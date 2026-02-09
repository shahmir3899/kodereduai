"""
Django settings for KoderEduAI.pk Platform.
"""

import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# =============================================================================
# Environment Toggle: set ENVIRONMENT=production in your .env to harden everything
# =============================================================================
ENVIRONMENT = os.getenv('ENVIRONMENT', 'local')
IS_PRODUCTION = ENVIRONMENT == 'production'

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv(
    'DJANGO_SECRET_KEY',
    'django-insecure-dev-key-change-in-production' if not IS_PRODUCTION else '',
)
if IS_PRODUCTION and not SECRET_KEY:
    raise ValueError('DJANGO_SECRET_KEY must be set in production!')

# DEBUG is derived from ENVIRONMENT — no separate toggle needed
DEBUG = not IS_PRODUCTION

ALLOWED_HOSTS = [h.strip() for h in os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',')]

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third party apps
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',

    # Local apps
    'core',
    'schools',
    'users',
    'students',
    'attendance',
    'notifications',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    'core.middleware.TenantMiddleware',  # Custom multi-tenancy middleware
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database
# Use PostgreSQL in production, SQLite for development
if os.getenv('DATABASE_URL'):
    import dj_database_url
    DATABASES = {
        'default': dj_database_url.config(default=os.getenv('DATABASE_URL'))
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Custom User Model
AUTH_USER_MODEL = 'users.User'

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Karachi'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Media files
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# =============================================================================
# Django REST Framework
# =============================================================================
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.FlexiblePageNumberPagination',
    'PAGE_SIZE': 20,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '30/minute',
        'user': '120/minute',
    },
}

# =============================================================================
# JWT Settings
# =============================================================================
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=1),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=7),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
    'AUTH_HEADER_TYPES': ('Bearer',),
    'AUTH_TOKEN_CLASSES': ('rest_framework_simplejwt.tokens.AccessToken',),
}

# =============================================================================
# CORS Settings
# =============================================================================
CORS_ALLOWED_ORIGINS = [o.strip() for o in os.getenv('CORS_ALLOWED_ORIGINS', 'http://localhost:3000').split(',')]
CORS_ALLOW_CREDENTIALS = True

# =============================================================================
# Celery Configuration
# =============================================================================
CELERY_BROKER_URL = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.getenv('CELERY_RESULT_BACKEND', 'redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Asia/Karachi'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes

# =============================================================================
# AI / LLM Configuration
# =============================================================================
GROQ_API_KEY = os.getenv('GROQ_API_KEY', '')
GROQ_MODEL = os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile')

# Vision Pipeline: Use vision AI instead of OCR for handwritten registers
# Set to False to use legacy Tesseract OCR pipeline
USE_VISION_PIPELINE = os.getenv('USE_VISION_PIPELINE', 'True').lower() in ('true', '1', 'yes')

# Vision provider: 'google' (recommended), 'groq'
# Google Vision has specialized handwriting detection - best for handwritten registers
VISION_PROVIDER = os.getenv('VISION_PROVIDER', 'google')

# Groq Vision model (if using groq provider)
GROQ_VISION_MODEL = os.getenv('GROQ_VISION_MODEL', 'llama-3.2-11b-vision-preview')

# Google Cloud Vision API Configuration
# Option 1: Use API Key (simpler setup)
GOOGLE_VISION_API_KEY = os.getenv('GOOGLE_VISION_API_KEY', '')
# Option 2: Use Service Account JSON file (more secure, supports more features)
GOOGLE_APPLICATION_CREDENTIALS = os.getenv('GOOGLE_APPLICATION_CREDENTIALS', '')

# OCR Configuration (legacy - used when USE_VISION_PIPELINE=False)
TESSERACT_CMD = os.getenv('TESSERACT_CMD', r'C:\Program Files\Tesseract-OCR\tesseract.exe')

# =============================================================================
# Supabase Configuration (for file storage)
# =============================================================================
SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')
SUPABASE_BUCKET = os.getenv('SUPABASE_BUCKET', 'attendance-uploads')

# =============================================================================
# WhatsApp Configuration
# =============================================================================
WHATSAPP_API_URL = os.getenv('WHATSAPP_API_URL', '')
WHATSAPP_API_KEY = os.getenv('WHATSAPP_API_KEY', '')

# =============================================================================
# Attendance AI Settings
# =============================================================================
ATTENDANCE_AI_SETTINGS = {
    'MIN_IMAGE_WIDTH': 300,
    'MIN_IMAGE_HEIGHT': 300,
    'OCR_CONFIDENCE_THRESHOLD': 0.7,
    'FUZZY_MATCH_THRESHOLD': 70,  # Minimum score for fuzzy name matching
}

# =============================================================================
# Production Security Settings
# =============================================================================
if IS_PRODUCTION:
    # HTTPS: Render handles SSL at the load balancer — no redirect needed inside Django.
    # SECURE_SSL_REDIRECT is intentionally False to avoid breaking Render health checks.
    SECURE_SSL_REDIRECT = False
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

    # HSTS (HTTP Strict Transport Security)
    SECURE_HSTS_SECONDS = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

    # Cookie security
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True

    # Content security
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = 'DENY'

    # Tighten JWT in production
    SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'] = timedelta(hours=1)
    SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'] = timedelta(days=1)

# =============================================================================
# Logging Configuration
# =============================================================================
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {process:d} {thread:d} {message}',
            'style': '{',
        },
        'simple': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'DEBUG' if not IS_PRODUCTION else 'WARNING',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'DEBUG' if not IS_PRODUCTION else 'WARNING',
            'propagate': False,
        },
        'django.request': {
            'handlers': ['console'],
            'level': 'DEBUG' if not IS_PRODUCTION else 'ERROR',
            'propagate': False,
        },
        'attendance': {
            'handlers': ['console'],
            'level': 'DEBUG' if not IS_PRODUCTION else 'INFO',
            'propagate': False,
        },
        'schools': {
            'handlers': ['console'],
            'level': 'DEBUG' if not IS_PRODUCTION else 'INFO',
            'propagate': False,
        },
        'users': {
            'handlers': ['console'],
            'level': 'DEBUG' if not IS_PRODUCTION else 'INFO',
            'propagate': False,
        },
    },
}
