//! A plain-text SMTP server on a local port that keeps what it receives.

use std::sync::{Arc, Mutex};

use tokio::{
  io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
  net::TcpListener,
};

pub struct FakeSmtp {
  pub port: u16,
  /// Every line clients sent, message bodies included.
  received: Arc<Mutex<Vec<String>>>,
}

impl FakeSmtp {
  /// A server that accepts every message.
  pub async fn start() -> Self {
    Self::answering_rcpt("250 2.1.5 OK").await
  }

  /// A server that gives `reply` to every recipient.
  pub async fn answering_rcpt(reply: &'static str) -> Self {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let received = Arc::new(Mutex::new(Vec::new()));
    let log = received.clone();
    tokio::spawn(async move {
      while let Ok((stream, _)) = listener.accept().await {
        let log = log.clone();
        tokio::spawn(async move {
          let (reader, mut writer) = stream.into_split();
          let mut lines = BufReader::new(reader).lines();
          writer.write_all(b"220 fake ESMTP\r\n").await.unwrap();
          let rcpt = format!("{reply}\r\n");
          let mut in_data = false;
          while let Ok(Some(line)) = lines.next_line().await {
            log.lock().unwrap().push(line.clone());
            if in_data {
              if line == "." {
                in_data = false;
                writer.write_all(b"250 2.0.0 queued\r\n").await.unwrap();
              }
              continue;
            }
            let command = line.to_ascii_uppercase();
            let answer = if command.starts_with("EHLO") {
              "250-fake\r\n250 AUTH PLAIN LOGIN\r\n"
            } else if command.starts_with("AUTH") {
              "235 2.7.0 OK\r\n"
            } else if command.starts_with("RCPT") {
              &rcpt
            } else if command.starts_with("DATA") {
              in_data = true;
              "354 go ahead\r\n"
            } else if command.starts_with("QUIT") {
              writer.write_all(b"221 bye\r\n").await.unwrap();
              break;
            } else {
              "250 OK\r\n"
            };
            writer.write_all(answer.as_bytes()).await.unwrap();
          }
        });
      }
    });
    Self { port, received }
  }

  pub fn received(&self) -> String {
    self.received.lock().unwrap().join("\n")
  }
}

impl FakeSmtp {
  /// The newest 6-digit code sent to `to`, waiting up to two seconds for the
  /// message: dopgate sends mail in the background.
  pub async fn code_for(
    &self,
    to: &str,
  ) -> String {
    for _ in 0..40 {
      if let Some(code) = self.last_code_for(to) {
        return code;
      }
      tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("no code was sent to {to}:\n{}", self.received());
  }

  /// Wait until a message to `to` arrived and return how many did.
  pub async fn wait_for(
    &self,
    to: &str,
    count: usize,
  ) -> usize {
    for _ in 0..40 {
      let found = self.messages_to(to).len();
      if found >= count {
        return found;
      }
      tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    self.messages_to(to).len()
  }

  /// Each message's lines, split on the end-of-data marker.
  pub fn messages_to(
    &self,
    to: &str,
  ) -> Vec<String> {
    let log = self.received.lock().unwrap().clone();
    let mut messages = Vec::new();
    let mut current: Option<(String, Vec<String>)> = None;
    let mut recipient = String::new();
    for line in log {
      let upper = line.to_ascii_uppercase();
      if upper.starts_with("RCPT TO:") {
        recipient = line[8..].trim().trim_matches(['<', '>']).to_owned();
      } else if upper == "DATA" {
        current = Some((recipient.clone(), Vec::new()));
      } else if line == "." {
        if let Some((rcpt, lines)) = current.take()
          && rcpt.eq_ignore_ascii_case(to)
        {
          messages.push(lines.join("\n"));
        }
      } else if let Some((_, lines)) = current.as_mut() {
        lines.push(line);
      }
    }
    messages
  }

  fn last_code_for(
    &self,
    to: &str,
  ) -> Option<String> {
    self.messages_to(to).iter().rev().find_map(|message| {
      message
        .lines()
        .map(str::trim)
        .find(|line| line.len() == 6 && line.bytes().all(|byte| byte.is_ascii_digit()))
        .map(str::to_owned)
    })
  }
}
