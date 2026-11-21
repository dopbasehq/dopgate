use anstyle::{AnsiColor, Color, Effects, Style};
use serde_json::Value;

pub fn print_success(message: &str) {
  let style = Style::new()
    .fg_color(Some(Color::Ansi(AnsiColor::Green)))
    .effects(Effects::BOLD);
  anstream::println!("{style}✓{style:#} {message}");
}

pub fn print_info(message: &str) {
  anstream::println!("{message}");
}

pub fn print_json(value: &Value) {
  println!("{value}");
}

/// Errors go to standard error, like the ones `main` prints.
pub fn print_error(message: &str) {
  anstream::eprintln!("{message}");
}

pub fn print_error_json(value: &Value) {
  eprintln!("{value}");
}
