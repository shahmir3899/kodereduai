from django.contrib import admin, messages

from .models import BrochureSection, CareerApplication, DemoRequest, ContactEnquiry
from .views import send_landing_form_email


@admin.register(BrochureSection)
class BrochureSectionAdmin(admin.ModelAdmin):
    list_display = ['key', 'title', 'order', 'is_visible', 'updated_at']
    list_editable = ['order', 'is_visible']
    ordering = ['order']


@admin.register(CareerApplication)
class CareerApplicationAdmin(admin.ModelAdmin):
    list_display = ['full_name', 'email', 'role_applied', 'source', 'created_at']
    readonly_fields = ['created_at', 'ip_address', 'user_agent']
    ordering = ['-created_at']


@admin.action(description='Resend email for selected demo requests')
def resend_demo_request_emails(modeladmin, request, queryset):
    sent = 0
    failed = 0
    for obj in queryset:
        success = send_landing_form_email(
            subject='Education AI - Form Demo Request',
            template_name='brochure/emails/demo_request.html',
            context={
                'title': 'Education AI - Form Demo Request',
                'accent_color': '#2563eb',
                'accent_soft': '#dbeafe',
                'name': obj.name or '-',
                'school': obj.school or '-',
                'email': obj.email or '-',
                'preferred_date': obj.preferred_date or '-',
            },
            reply_to=[obj.email] if obj.email else None,
        )
        if success:
            obj.email_sent = True
            obj.save(update_fields=['email_sent'])
            sent += 1
        else:
            failed += 1

    if sent:
        modeladmin.message_user(request, f'{sent} email(s) resent successfully.', messages.SUCCESS)
    if failed:
        modeladmin.message_user(request, f'{failed} email(s) failed — check SMTP settings.', messages.ERROR)


@admin.register(DemoRequest)
class DemoRequestAdmin(admin.ModelAdmin):
    list_display = ['name', 'school', 'email', 'preferred_date', 'email_sent', 'created_at']
    list_filter = ['email_sent']
    readonly_fields = ['created_at', 'ip_address', 'email_sent']
    ordering = ['-created_at']
    actions = [resend_demo_request_emails]


@admin.action(description='Resend email for selected contact enquiries')
def resend_contact_enquiry_emails(modeladmin, request, queryset):
    sent = 0
    failed = 0
    for obj in queryset:
        success = send_landing_form_email(
            subject='Education AI - Form Contact Enquiry',
            template_name='brochure/emails/contact_enquiry.html',
            context={
                'title': 'Education AI - Form Contact Enquiry',
                'accent_color': '#0f766e',
                'accent_soft': '#ccfbf1',
                'name': obj.name or '-',
                'school': obj.school or '-',
                'email': obj.email or '-',
                'phone': obj.phone or '-',
                'message': obj.message or '-',
            },
            reply_to=[obj.email] if obj.email else None,
        )
        if success:
            obj.email_sent = True
            obj.save(update_fields=['email_sent'])
            sent += 1
        else:
            failed += 1

    if sent:
        modeladmin.message_user(request, f'{sent} email(s) resent successfully.', messages.SUCCESS)
    if failed:
        modeladmin.message_user(request, f'{failed} email(s) failed — check SMTP settings.', messages.ERROR)


@admin.register(ContactEnquiry)
class ContactEnquiryAdmin(admin.ModelAdmin):
    list_display = ['name', 'school', 'email', 'phone', 'email_sent', 'created_at']
    list_filter = ['email_sent']
    readonly_fields = ['created_at', 'ip_address', 'email_sent']
    ordering = ['-created_at']
    actions = [resend_contact_enquiry_emails]
