from rest_framework import serializers
from .models import BrochureSection, CareerApplication


class BrochureSectionSerializer(serializers.ModelSerializer):
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = BrochureSection
        fields = [
            'id', 'key', 'title', 'order', 'content', 'content_html',
            'is_visible', 'updated_at', 'updated_by', 'updated_by_name',
        ]
        read_only_fields = ['id', 'key', 'updated_at', 'updated_by', 'updated_by_name']

    def get_updated_by_name(self, obj):
        if obj.updated_by:
            return obj.updated_by.get_full_name() or obj.updated_by.username
        return None

    def update(self, instance, validated_data):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            instance.updated_by = request.user
        return super().update(instance, validated_data)


class CareerApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = CareerApplication
        fields = [
            'id',
            'full_name',
            'email',
            'phone',
            'role_applied',
            'cover_letter',
            'cv_file',
            'source',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_cv_file(self, value):
        max_size = 5 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError('CV file must be 5 MB or smaller.')

        allowed_types = {
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
        content_type = getattr(value, 'content_type', '')
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError('Only PDF, DOC, or DOCX files are allowed.')

        allowed_ext = {'.pdf', '.doc', '.docx'}
        filename = getattr(value, 'name', '').lower()
        if not any(filename.endswith(ext) for ext in allowed_ext):
            raise serializers.ValidationError('Unsupported file extension. Use PDF, DOC, or DOCX.')

        return value


class DemoRequestSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    school = serializers.CharField(max_length=160)
    email = serializers.EmailField()
    preferred_date = serializers.DateField(required=False, allow_null=True)


class ContactEnquirySerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    school = serializers.CharField(max_length=160)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    message = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)
