pub const CONFIG_SEED: &[u8] = b"config";
pub const HANDLE_SEED: &[u8] = b"handle";
pub const WALLET_OF_HANDLE_SEED: &[u8] = b"wallet_of_handle";
pub const REGISTRATION_SEED: &[u8] = b"registration";

/// X handles are short (max 15 chars per X's own rules, plus room for an optional leading
/// "@" and some headroom) -- 64 matches sso_solana's own MAX_KEYWORD_LEN cap for the same
/// "Solana account space must be fixed upfront" reason (see that constant's own comment).
pub const MAX_X_HANDLE_LEN: usize = 64;
