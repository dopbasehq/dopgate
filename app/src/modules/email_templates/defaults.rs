//! The built-in templates. They work without any setup; admins can override
//! each one through the API.

/// One template: what it is for, which variables it accepts, and its
/// built-in subject, HTML, and text.
pub struct Builtin {
  pub name: &'static str,
  pub description: &'static str,
  pub variables: &'static [&'static str],
  pub subject: &'static str,
  pub html: &'static str,
  pub text: &'static str,
}

const CODE_VARIABLES: &[&str] = &[
  "app_name",
  "email",
  "display_name",
  "code",
  "expires_minutes",
];

macro_rules! html {
  ($body:literal) => {
    concat!(
      r#"<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:8px;padding:32px;">
<tr><td>
<p style="margin:0 0 24px;font-size:15px;font-weight:600;">{{app_name}}</p>
"#,
      $body,
      r#"</td></tr>
</table>
</td></tr></table>
</body>
</html>
"#
    )
  };
}

pub const ALL: &[Builtin] = &[
  Builtin {
    name: "verify_email",
    description: "Sent after sign-up, and whenever a user asks to confirm their email.",
    variables: CODE_VARIABLES,
    subject: "Your {{app_name}} code is {{code}}",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Enter this code to confirm your email address:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace;">{{code}}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">It expires in {{expires_minutes}} minutes. If you didn't sign up for {{app_name}}, you can ignore this email.</p>
"#
    ),
    text: "Enter this code to confirm your email address:\n\n    {{code}}\n\nIt expires in {{expires_minutes}} minutes. If you didn't sign up for {{app_name}}, you can ignore this email.\n",
  },
  Builtin {
    name: "login_code",
    description: "Sent when a user signs in with an emailed code instead of a password.",
    variables: CODE_VARIABLES,
    subject: "Your {{app_name}} sign-in code is {{code}}",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Enter this code to sign in:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace;">{{code}}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">It expires in {{expires_minutes}} minutes. If you didn't try to sign in, you can ignore this email. Nobody can sign in without the code.</p>
"#
    ),
    text: "Enter this code to sign in:\n\n    {{code}}\n\nIt expires in {{expires_minutes}} minutes. If you didn't try to sign in, you can ignore this email. Nobody can sign in without the code.\n",
  },
  Builtin {
    name: "password_reset",
    description: "Sent when a user forgets their password, or an admin sends a reset.",
    variables: CODE_VARIABLES,
    subject: "Reset your {{app_name}} password",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Use this code to choose a new password:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace;">{{code}}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">It expires in {{expires_minutes}} minutes. If you didn't ask for a reset, ignore this email and your password stays the same.</p>
"#
    ),
    text: "Use this code to choose a new password:\n\n    {{code}}\n\nIt expires in {{expires_minutes}} minutes. If you didn't ask for a reset, ignore this email and your password stays the same.\n",
  },
  Builtin {
    name: "email_change",
    description: "Sent to the new address when a user changes their email.",
    variables: &[
      "app_name",
      "email",
      "display_name",
      "code",
      "expires_minutes",
      "new_email",
    ],
    subject: "Confirm your new {{app_name}} email",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Enter this code to move your {{app_name}} account to {{new_email}}:</p>
<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:Menlo,Consolas,monospace;">{{code}}</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">It expires in {{expires_minutes}} minutes. If you didn't ask for this, you can ignore this email.</p>
"#
    ),
    text: "Enter this code to move your {{app_name}} account to {{new_email}}:\n\n    {{code}}\n\nIt expires in {{expires_minutes}} minutes. If you didn't ask for this, you can ignore this email.\n",
  },
  Builtin {
    name: "email_changed",
    description: "Sent to the old address after an email change goes through.",
    variables: &["app_name", "email", "display_name", "new_email"],
    subject: "Your {{app_name}} email was changed",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">The email on your {{app_name}} account changed from {{email}} to {{new_email}}.</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">If you didn't make this change, contact the {{app_name}} team right away.</p>
"#
    ),
    text: "The email on your {{app_name}} account changed from {{email}} to {{new_email}}.\n\nIf you didn't make this change, contact the {{app_name}} team right away.\n",
  },
  Builtin {
    name: "password_changed",
    description: "Sent after a password is changed or reset.",
    variables: &["app_name", "email", "display_name"],
    subject: "Your {{app_name}} password was changed",
    html: html!(
      r#"<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">The password for {{email}} on {{app_name}} was just changed, and other devices were signed out.</p>
<p style="margin:0;font-size:13px;line-height:1.6;color:#71717a;">If you didn't do this, reset your password now and contact the {{app_name}} team.</p>
"#
    ),
    text: "The password for {{email}} on {{app_name}} was just changed, and other devices were signed out.\n\nIf you didn't do this, reset your password now and contact the {{app_name}} team.\n",
  },
];

pub fn find(name: &str) -> Option<&'static Builtin> {
  ALL.iter().find(|template| template.name == name)
}
