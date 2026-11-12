use std::net::IpAddr;

use app::services::client_ip::{ProxyNetwork, parse_list, resolve};

fn ip(value: &str) -> IpAddr {
  value.parse().unwrap()
}

#[test]
fn untrusted_peers_cannot_claim_another_address() {
  let trusted = parse_list("10.0.0.0/8").unwrap();
  assert_eq!(
    resolve(Some(ip("203.0.113.9")), "198.51.100.1", &trusted),
    Some(ip("203.0.113.9"))
  );
}

#[test]
fn trusted_proxies_pass_on_the_first_untrusted_hop() {
  let trusted = parse_list("10.0.0.0/8, 127.0.0.1").unwrap();
  // Read right to left: the proxy at 10.0.0.2 saw 198.51.100.7. The
  // leftmost entry is whatever the client claimed and is ignored.
  assert_eq!(
    resolve(
      Some(ip("127.0.0.1")),
      "1.2.3.4, 198.51.100.7, 10.0.0.2",
      &trusted
    ),
    Some(ip("198.51.100.7"))
  );
}

#[test]
fn garbage_in_the_header_stops_at_the_last_trusted_hop() {
  let trusted = parse_list("127.0.0.1").unwrap();
  assert_eq!(
    resolve(Some(ip("127.0.0.1")), "not-an-ip", &trusted),
    Some(ip("127.0.0.1"))
  );
}

#[test]
fn ipv4_mapped_ipv6_peers_match_ipv4_rules() {
  let trusted = parse_list("127.0.0.1").unwrap();
  assert_eq!(
    resolve(Some(ip("::ffff:127.0.0.1")), "198.51.100.7", &trusted),
    Some(ip("198.51.100.7"))
  );
}

#[test]
fn no_peer_means_no_address() {
  assert_eq!(resolve(None, "198.51.100.7", &[]), None);
}

#[test]
fn proxy_networks_parse_addresses_and_ranges() {
  let network: ProxyNetwork = "10.1.0.0/16".parse().unwrap();
  assert!(network.contains(ip("10.1.200.3")));
  assert!(!network.contains(ip("10.2.0.1")));
  assert!("10.0.0.0/33".parse::<ProxyNetwork>().is_err());
  assert!("not-a-network".parse::<ProxyNetwork>().is_err());
}
