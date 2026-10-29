use anchor_lang::prelude::*;

#[error_code]
pub enum RegistryError {
    #[msg("not authority")]
    NotAuthority,
    #[msg("not attestor")]
    NotAttestor,
    #[msg("x handle is too long")]
    HandleTooLong,
    #[msg("arithmetic overflow")]
    Overflow,
}
