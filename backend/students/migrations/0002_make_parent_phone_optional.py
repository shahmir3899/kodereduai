from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('students', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='student',
            name='parent_phone',
            field=models.CharField(
                blank=True,
                default='',
                help_text="Parent's phone number for absence notifications",
                max_length=20
            ),
        ),
    ]
