# CHECKPOINT — NEXUS 0.6.1d, 05.11.2026

Продолжать существующий worktree C:\Users\krado\Documents\NEXUS\_src-next-0.6.1d.
Ветка experiment/nexus-0.6.1d-acceptance-fixes-20261105; HEAD кода 6bbabe8b5a174b4d5f286ef4f574ddcc9161dfae; последовательность b4b43b8 (Format-List), eaffb74 (NX03), 93fe468 (NX13), af8fc4b (NX19), 6bbabe8 (NX21). Основа 5043be7 / диагностика 422f691 сохранены.
Исходные изменения разделены по отдельным коммитам и опубликованы через NEXUS Host. Ревью владельца/Claude ещё не проведено. Никаких установок, рестартов Host, изменений Gateway/main/security/power/owner signatures не выполнено.

Восемь изменённых source/test файлов: apps.mjs, consent.mjs, consent.test.mjs, procs.mjs, stage2-052.test.mjs, uia-script.mjs, windows.mjs, windows.test.mjs (все windows-pc-agent-lab/nexus-host/).
Дополнительно: NEXUS-NEXT-0.6.1d-REPORT-20261105.md, этот checkpoint, ACTIVATE-NEXT-0.6.1d.md.

Review package: C:\Users\krado\Documents\Codex\2026-11-05\new-chat\outputs\nexus-0.6.1d-review.
Там отдельные 01-NX13.patch / 02-NX19.patch / 03-NX21.patch, исходный eaffb74 patch, сохранённая правка Antigravity, логи и SHA256SUMS.txt. Patches проверены последовательным применением к копии HEAD. Не применять повторно к текущему working tree; использовать git apply --cached после проверки владельцем.

Локально: 71 PASS / 0 FAIL / 1 SKIP в затронутых suites; после последней доработки NX21 его 2 теста PASS. SKIP — real GUI/Notepad, требует NEXUS_REAL_GUI=1, не относится к NX13/19/21. CI 42013344466 на source SHA 6bbabe8: Windows PASS, Linux PASS, Gateway PASS. Реальная приёмка NX03/13/19/21/26 остаётся BLOCKED. Автовозобновление — существующий контракт NEXT-1, ошибка не доказана, код не трогали. Format-List не изменялся и отдельно не повторялся.

Следующее: независимое ревью коммитов и отчёта; отдельное разрешение на установку по ACTIVATE (backup, контроль хэшей, откат); только затем реальная адресная приёмка NX03/13/19/21. NX26 требует диагностики доступного владельцу desktop, догадочных обходов нет. Не повторять ZIP/download/C.5 и ранее прошедшие тесты. Реальный Host 0.6.1c остаётся рабочим и НЕ изменён.
