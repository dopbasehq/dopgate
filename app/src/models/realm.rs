//! The two sides of Dopgate. The console realm holds root and admins; the
//! app realm holds the people who sign in to your app. Each realm has its own
//! tables, and code that works on both picks them here, so a query only ever
//! reads one side. The names are fixed strings, never input, so they are safe
//! to format into SQL.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Realm {
  /// Root and admins, signed in to the console.
  Console,
  /// Your app's users.
  App,
}

impl Realm {
  /// The accounts table.
  pub const fn accounts(self) -> &'static str {
    match self {
      Self::Console => "admins",
      Self::App => "users",
    }
  }

  pub const fn sessions(self) -> &'static str {
    match self {
      Self::Console => "admin_sessions",
      Self::App => "sessions",
    }
  }

  pub const fn refresh_tokens(self) -> &'static str {
    match self {
      Self::Console => "admin_refresh_tokens",
      Self::App => "refresh_tokens",
    }
  }

  /// Emailed codes.
  pub const fn codes(self) -> &'static str {
    match self {
      Self::Console => "admin_codes",
      Self::App => "verification_tokens",
    }
  }

  /// The column in sessions and codes that points at the account.
  pub const fn owner_column(self) -> &'static str {
    match self {
      Self::Console => "admin_id",
      Self::App => "user_id",
    }
  }

  /// The prefix of account IDs.
  pub const fn id_prefix(self) -> &'static str {
    match self {
      Self::Console => crate::constants::tokens::ADMIN_ID_PREFIX,
      Self::App => crate::constants::tokens::USER_ID_PREFIX,
    }
  }

  /// The resource type audit events use for an account.
  pub const fn resource(self) -> &'static str {
    match self {
      Self::Console => "admin",
      Self::App => "user",
    }
  }

  /// Short name used in rate-limit keys, so the same email on both sides
  /// has separate budgets.
  pub const fn key(self) -> &'static str {
    match self {
      Self::Console => "console",
      Self::App => "app",
    }
  }
}
