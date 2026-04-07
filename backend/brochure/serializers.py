from rest_framework import serializers
from .models import BrochureSection


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
