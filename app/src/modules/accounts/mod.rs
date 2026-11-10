//! What admins and users have in common: finding an account, the password,
//! the lockout, and the verified email. Each function takes the realm, which
//! picks the table, so the sign-in, session, and code logic is written once
//! for both sides. Everything specific to one side lives in `admins` or
//! `users`.

pub(crate) mod repository;
