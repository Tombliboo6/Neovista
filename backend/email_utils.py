import resend
import logging
import os
import re


logger = logging.getLogger(__name__)


def send_verification_email(to_email: str, code: str) -> bool:
    """发送验证码邮件"""
    try:
        if not re.fullmatch(r"[0-9]{6}", code or ""):
            logger.warning("verification email rejected invalid code format")
            return False

        api_key = os.getenv("RESEND_API_KEY")
        if not api_key:
            logger.error("verification email configuration is incomplete")
            return False

        from_email = os.getenv("RESEND_FROM_EMAIL")
        if not from_email:
            logger.error("verification email configuration is incomplete")
            return False

        resend.api_key = api_key

        params = {
            'from': from_email,
            'to': [to_email],
            'subject': '【NeoVista】您的注册验证码',
            'html': f'<p>欢迎注册 NeoVista，您的验证码是：<strong>{code}</strong>，5分钟内有效。</p>'
        }

        resend.Emails.send(params)
        logger.info("verification email accepted by provider")
        return True
    except Exception as e:
        logger.warning("verification email delivery failed (%s)", type(e).__name__)
        return False
