// 与脚本的 applyGameRecordStorageOperation 保持同一协议：只合并本次回包，
// reset 递增 revision，旧窗口不能把清除前的快照写回。
function applyGameRecordStorageOperation(state, operation) {
    state = state || { revision: 0, accounts: {}, migrated: {} };
    const source = operation.source || 'local';
    if (!state.migrationClosed && !state.migrated[source]) {
        for (const [account, modes] of Object.entries(operation.legacy || {})) {
            if (!/^\d+$/.test(account)) continue;
            const target = state.accounts[account] || (state.accounts[account] = {});
            for (const [mode, records] of Object.entries(modes || {})) {
                if (!/^\d+$/.test(mode)) continue;
                const dest = target[mode] || (target[mode] = {});
                for (const [time, record] of Object.entries(records || {})) {
                    if (/^\d+$/.test(time) && !dest[time]) dest[time] = record;
                }
            }
        }
        state.migrated[source] = true;
    }
    if (operation.action === 'reset') {
        state.accounts = {};
        state.revision += 1;
        state.migrationClosed = true;
    } else if (operation.action === 'merge' && (operation.revision == null || operation.revision === state.revision)) {
        if (!/^\d+$/.test(String(operation.accountId)) || !/^\d+$/.test(String(operation.modeId))) throw new Error('invalid game record key');
        const account = state.accounts[operation.accountId] || (state.accounts[operation.accountId] = {});
        const records = account[operation.modeId] || (account[operation.modeId] = {});
        for (const [time, record] of Object.entries(operation.records || {})) {
            if (/^\d+$/.test(time)) records[time] = { ...records[time], ...record };
        }
    }
    return state;
}

module.exports = { applyGameRecordStorageOperation };
