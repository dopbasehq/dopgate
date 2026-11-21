use app::services::allocator;

/// On glibc the allocator has to take the threshold. Everywhere else there
/// is nothing to set. A second call changes nothing.
#[test]
fn the_allocator_takes_the_mmap_threshold() {
  assert!(allocator::pin_mmap_threshold());
  assert!(allocator::pin_mmap_threshold());
}

/// With the threshold pinned, glibc maps a block the size of a password
/// hash every time and unmaps it when it is freed. Without it, the second
/// block would come out of a heap that glibc keeps.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
#[test]
fn a_block_the_size_of_a_hash_is_mapped_every_time() {
  use std::ffi::c_void;

  unsafe extern "C" {
    fn malloc(size: usize) -> *mut c_void;
    fn free(pointer: *mut c_void);
    fn malloc_usable_size(pointer: *mut c_void) -> usize;
  }
  const BLOCK: usize = 19 * 1024 * 1024;
  // glibc keeps a flag in the word before a block: bit 1 is set when the
  // block came from mmap.
  const IS_MMAPPED: usize = 0b10;

  assert!(allocator::pin_mmap_threshold());
  for round in 0..4 {
    unsafe {
      let block = malloc(BLOCK);
      assert!(!block.is_null());
      assert!(malloc_usable_size(block) >= BLOCK);
      let header = *block.cast::<usize>().sub(1);
      free(block);
      assert_eq!(header & IS_MMAPPED, IS_MMAPPED, "round {round}");
    }
  }
}
