//! A small `{{name}}` renderer. Templates hold no logic: each placeholder
//! is replaced by a value, HTML-escaped in the HTML part. Spaces inside the
//! braces are allowed, as in `{{ code }}`.

use std::collections::BTreeMap;

pub type Values = BTreeMap<&'static str, String>;

/// Every placeholder name in `template`, in order of appearance.
pub fn placeholders(template: &str) -> Vec<String> {
  let mut found = Vec::new();
  let mut rest = template;
  while let Some(start) = rest.find("{{") {
    let after = &rest[start + 2..];
    let Some(end) = after.find("}}") else {
      break;
    };
    found.push(after[..end].trim().to_owned());
    rest = &after[end + 2..];
  }
  found
}

/// Whether the template has a `{{` that never closes.
pub fn has_unclosed(template: &str) -> bool {
  let mut rest = template;
  while let Some(start) = rest.find("{{") {
    let after = &rest[start + 2..];
    match after.find("}}") {
      Some(end) => rest = &after[end + 2..],
      None => return true,
    }
  }
  false
}

pub fn render(
  template: &str,
  values: &Values,
  escape: bool,
) -> String {
  let mut output = String::with_capacity(template.len());
  let mut rest = template;
  while let Some(start) = rest.find("{{") {
    output.push_str(&rest[..start]);
    let after = &rest[start + 2..];
    let Some(end) = after.find("}}") else {
      output.push_str(&rest[start..]);
      return output;
    };
    let name = after[..end].trim();
    let value = values.get(name).map(String::as_str).unwrap_or_default();
    if escape {
      output.push_str(&escape_html(value));
    } else {
      output.push_str(value);
    }
    rest = &after[end + 2..];
  }
  output.push_str(rest);
  output
}

pub fn escape_html(value: &str) -> String {
  let mut escaped = String::with_capacity(value.len());
  for character in value.chars() {
    match character {
      '&' => escaped.push_str("&amp;"),
      '<' => escaped.push_str("&lt;"),
      '>' => escaped.push_str("&gt;"),
      '"' => escaped.push_str("&quot;"),
      '\'' => escaped.push_str("&#39;"),
      other => escaped.push(other),
    }
  }
  escaped
}

/// Subjects are one header line: control characters become spaces.
pub fn subject_line(value: &str) -> String {
  value
    .chars()
    .map(|character| {
      if character.is_control() {
        ' '
      } else {
        character
      }
    })
    .collect::<String>()
    .trim()
    .to_owned()
}
