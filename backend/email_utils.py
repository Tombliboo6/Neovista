import resend
import os

def send_verification_email(to_email: str, code: str) -> bool:
    """发送验证码邮件"""
    try:
        api_key = os.getenv("RESEND_API_KEY")
        if not api_key:
            print("❌ RESEND_API_KEY 未配置")
            return False

        from_email = os.getenv("RESEND_FROM_EMAIL")
        if not from_email:
            print("❌ RESEND_FROM_EMAIL 未配置，请填写已在 Resend 验证过的发件邮箱")
            return False

        resend.api_key = api_key
        print(f"📧 准备发送验证码到: {to_email}")

        params = {
            'from': from_email,
            'to': [to_email],
            'subject': '【NeoVista】您的注册验证码',
            'html': f'<p>欢迎注册 NeoVista，您的验证码是：<strong>{code}</strong>，5分钟内有效。</p>'
        }

        result = resend.Emails.send(params)
        print(f"✅ 邮件发送成功: {result}")
        return True
    except Exception as e:
        print(f"❌ 邮件发送失败: {type(e).__name__}: {e}")
        return False
