pub mod extract_services;

pub mod ailimit;
pub mod apmi2;
pub mod efmi3;
pub mod gf2;
pub mod gimi;
pub mod himi;
pub mod identityv;
pub mod naraka;
pub mod narakam;
pub mod ntemi;
pub mod snowbreak;
pub mod srmi;
pub mod wwmi;
pub mod yysls;
pub mod zzmi;
pub mod zzmi_dx12;

pub(crate) fn log_skipped_drawib(draw_ib: &str, reason: impl AsRef<str>) {
    crate::extract_log!(
        "[full_extract][skip] DrawIB {} skipped: {}",
        draw_ib,
        reason.as_ref()
    );
}
