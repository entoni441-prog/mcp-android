/**
 * Owner-attested pre-logon access gate. A successful OS restart is NOT implied.
 * This module intentionally does not accept an arbitrary provider/URL/host name.
 * ChatGPT may request attestation but cannot approve it: OWNER_WHATS + signed
 * owner_decide on the passphrase-protected Live page is mandatory.
 */
export const CRD_CHANNEL = 'chrome_remote_desktop';
export const CRD_EVIDENCE = 'owner_tested_full_signout_remote_signin_samsung';
export const CRD_OWNER_WHAT = 'logon_channel_attestation';

const exact = (v, keys) => !!v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).every(k=>keys.includes(k));

/** Fail closed: service must run independently of the interactive Windows session. */
export function assessLogonReadiness({services, autostart}) {
  const rows = Array.isArray(services?.data) ? services.data : [];
  const svc = rows.find(x => x?.Name === 'chromoting');
  const jobs = Array.isArray(autostart?.data?.tasks) ? autostart.data.tasks : [];
  const hostTask = jobs.find(x => x?.name === 'NEXUS-Host-Logon');
  const checks = {
    crdServicePresent: !!svc,
    crdServiceRunning: svc?.State === 'Running',
    crdAutoStart: svc?.StartMode === 'Auto',
    crdSystemService: svc?.StartName === 'LocalSystem',
    nexusLogonTask: !!hostTask && hostTask.state !== 'Disabled' &&
      Array.isArray(hostTask.triggers) && hostTask.triggers.some(x => /Logon/i.test(x)),
  };
  return {ready: Object.values(checks).every(Boolean), checks,
    blockers: Object.keys(checks).filter(k => !checks[k])};
}

/** Each request and its execution re-read the actual Host's service and tasks. */
export function createLogonAttestation({store, consent, diag, audit = () => {}}) {
  async function probe() {
    try {
      const [services, autostart] = await Promise.all([
        diag.system_info({topic:'services',filter:'chromoting'}),
        diag.system_info({topic:'autostart_nexus'}),
      ]);
      return assessLogonReadiness({services,autostart});
    } catch {
      return {ready:false, checks:{}, blockers:['independent_channel_diagnostics_unavailable']};
    }
  }
  return {
    probe,
    async logon_attestation(args = {}) {
      if(!exact(args,['action']) || !['status','request','revoke'].includes(args.action))
        throw Error('invalid_args');
      if(args.action==='revoke') {
        const r=store.recordLogonAttestation(false);
        audit({event:'logon_attestation_revoked',channel:CRD_CHANNEL});
        return {verified:false,revoked:true,changed:r.changed};
      }
      const evidence=await probe();
      if(args.action==='status') return {
        channel:CRD_CHANNEL,ownerAttested:store.view.logonChannelVerified===true,
        verified:store.view.logonChannelVerified===true && evidence.ready,
        ...evidence,postRebootTested:false,
      };
      if(!evidence.ready) return {status:'BLOCKED',channel:CRD_CHANNEL,
        verified:false,blockers:evidence.blockers,checks:evidence.checks};
      // The exact title appears in the Live owner's list. No evidence string,
      // phone password, CRD PIN or other secret is accepted from chat.
      return consent.requestGrant({
        what:CRD_OWNER_WHAT,
        target:'Аттестация CRD: я ЛИЧНО проверил вход с Samsung после полного выхода из Windows; Chrome Remote Desktop доступен до входа пользователя. Подтверждаю независимый канал для ОДНОЙ тестовой перезагрузки (после отдельного разрешения на restart). Это НЕ подтверждение уже выполненной перезагрузки.',
        apply:async()=>{
          const latest=await probe();
          if(!latest.ready) return {status:'BLOCKED',verified:false,blockers:latest.blockers};
          const stored=store.recordLogonAttestation(true);
          audit({event:'logon_attestation_confirmed',channel:CRD_CHANNEL,evidence:CRD_EVIDENCE,
            postRebootTested:false});
          return {verified:true,channel:CRD_CHANNEL,ownerConfirmed:true,
            postRebootTested:false,persisted:stored.persisted};
        },
      });
    },
  };
}
