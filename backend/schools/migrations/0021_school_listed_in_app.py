from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('schools', '0020_school_timezone'),
    ]

    operations = [
        migrations.AddField(
            model_name='school',
            name='listed_in_app',
            field=models.BooleanField(default=False, help_text="Show this school in the mobile app's school search"),
        ),
    ]
