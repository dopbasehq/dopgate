//! Keeps glibc from holding on to the memory of finished password hashes.
//!
//! A password hash allocates 19 MiB and frees it when it is done. glibc
//! serves a block that large with `mmap` at first. After the first free it
//! raises its mmap threshold above the block's size, and from then on it
//! keeps such blocks in its own heaps. Sign-ins then leave hundreds of MiB
//! resident that never go back to the system. Setting the threshold once
//! fixes it at glibc's starting value, so every hash maps its memory and
//! unmaps it again.
//!
//! Only glibc does this. musl, which the release archives are built with,
//! and macOS hand large blocks back on their own.

/// What the threshold is pinned to: glibc's own starting value, in bytes.
pub const MMAP_THRESHOLD_BYTES: i32 = 128 * 1024;

/// Pin the mmap threshold for the life of the process. Returns `false` when
/// glibc refused the value. Where there is nothing to set, on other
/// platforms or when the environment already sets the threshold, the answer
/// is `true`.
pub fn pin_mmap_threshold() -> bool {
  imp::pin_mmap_threshold()
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
mod imp {
  use std::ffi::c_int;

  use super::MMAP_THRESHOLD_BYTES;

  /// `M_MMAP_THRESHOLD` in glibc's `malloc.h`.
  const M_MMAP_THRESHOLD: c_int = -3;

  // SAFETY: this is glibc's `mallopt` as `malloc.h` declares it, and std
  // already links glibc on this target. The function takes two integers,
  // keeps no pointer and takes the allocator's own lock, so a call from any
  // thread with any values is sound. That is why it is declared `safe`.
  unsafe extern "C" {
    safe fn mallopt(
      param: c_int,
      value: c_int,
    ) -> c_int;
  }

  pub fn pin_mmap_threshold() -> bool {
    // Someone who set the threshold through glibc's own variables meant it.
    let chosen = std::env::var_os("MALLOC_MMAP_THRESHOLD_").is_some()
      || std::env::var_os("GLIBC_TUNABLES").is_some_and(|tunables| {
        tunables
          .to_string_lossy()
          .contains("glibc.malloc.mmap_threshold")
      });
    chosen || mallopt(M_MMAP_THRESHOLD, MMAP_THRESHOLD_BYTES) == 1
  }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
mod imp {
  pub fn pin_mmap_threshold() -> bool {
    true
  }
}
