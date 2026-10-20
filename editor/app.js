'use strict';

/* =========================================================================
   Moodle XML Editor — логика приложения
   Структура: XML-панель слева, редактор вопросов справа, настройки в модальном
   окне. Редактор работает с Moodle XML (вопросы типа multichoice с поддержкой
   LaTeX-формул для MathJax).
   ========================================================================= */

// --- Константы ---
const AUTOSAVE_DEBOUNCE_MS = 1500;      // задержка автосохранения после изменений
const TEST_APP_BASE_URL = 'https://tregubovvn.github.io/mt/index.html';
const GITVERSE_API = 'https://gitverse.ru/api/v2';
const GIST_FILENAME = 'quiz.xml';

// Стартовый шаблон — пример вопроса с формулой
const DEFAULT_QUIZ_XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
    <question type="multichoice">
        <name>
            <text>Пример: вопрос с формулой</text>
        </name>
        <questiontext format="html">
            <text><![CDATA[<p>Выберите правильную формулу: \\( \\alpha_{н} = \\frac{АД_{сэ}}{АД_{с}} \\)</p>]]></text>
        </questiontext>
        <answer fraction="100" format="html">
            <text><![CDATA[\\( \\alpha_{н} = \\frac{АД_{сэ}}{АД_{с}} \\)]]></text>
        </answer>
        <answer fraction="0" format="html">
            <text><![CDATA[\\( \\alpha_{н} = \\frac{АД_{с}}{АД_{сэ}} \\)]]></text>
        </answer>
        <answer fraction="0" format="html">
            <text><![CDATA[\\( \\alpha_{н} = АД_{сэ} + АД_{с} \\)]]></text>
        </answer>
    </question>
</quiz>`;

// Ключи localStorage
const LS = {
    ghToken: 'gh_token',
    dsToken: 'ds_token',
    gvToken: 'gv_token',
    autoSave: 'editor_autosave_enabled',
    dsMode: 'editor_deepseek_mode_moodle',     // id активного промпта/режима
    promptEdits: 'editor_ds_prompt_edits_moodle', // отредактированные пользователем промпты {id: text}
    promptsGist: 'editor_prompts_gist_url_moodle', // единая ссылка на Gist со всеми промптами (MD)
    lastSaveTime: 'editor_last_save_time_moodle',  // время последнего сохранения файла на диск
};

// --- Состояние ---
const state = {
    quizData: { name: '', questions: [] },   // name — название теста (в описание GIST)
    currentQuestionIndex: 0,
    gistId: null,
    gistUrl: null,
    rawUrl: null,
    gistFilename: GIST_FILENAME,
    gitverseProject: null,
    gitverseRawUrl: null,
    lastPublishTarget: null,                 // 'gist' | 'gitverse'
    // Все промпты DeepSeek: [{id, name, text, source:'gist'|'local'}].
    // Загружаются из ОДНОГО GitHub Gist в MD-формате (см. DEFAULT_PROMPTS_GIST_URL);
    // пользователь может добавить свои промпты и сохранить всё обратно в этот же Gist.
    prompts: [],
    dirty: false,               // есть несохранённые изменения в задании
    isSaving: false,
    needsAnotherSave: false,
    syncTimeout: null,
    autoSaveTimeout: null,
    previewTimeout: null,
    fileHandle: null,           // FileSystemFileHandle выбранного файла на диске
    loadedFileName: null,       // имя загруженного с диска файла (для сохранения через скачивание)
    aiBusy: false,              // идёт запрос к DeepSeek (интерфейс заблокирован)
};

// Флаг «изменение идёт из XML-панели» — XML-поле само является источником данных,
// его input НЕ должен вызывать пересинхронизацию редактор -> XML (рекурсия).
let applyingXmlToEditor = false;

// Последнее активное поле ввода в редакторе — туда вставляются формулы
let lastFocused = null;

// Отладочный доступ к состоянию из консоли браузера (window.editorState.state)
window.editorState = { state, api: {}, fn: {} };

let els = {};                   // кэш ссылок на DOM-элементы

// --- Инициализация ---
document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    loadSettings();
    parseXmlToData(DEFAULT_QUIZ_XML);
    renderAll();
    updateXmlOutput({ immediate: true, silent: true });
    renderModeSelect();
    updateLastSaveTimeLabel();
    initResizer();
    bindEvents();
    // Отладочный доступ к функциям (все объявления подняты — можно ссылаться)
    Object.assign(window.editorState.api, {
        publishToGist, publishToGitverse, saveToFile, loadFromDiskFile, askDeepSeek, setDsMode, currentDsMode,
        generateXml, parseXmlToData, loadPromptsFromGists, buildDsPrompt,
        openTask, copyTaskUrl, reloadActivePromptFromGist, savePromptEdit,
        addLocalPrompt, removePrompt, savePromptsToGist, getPromptsGistUrl, newQuiz,
    });
    loadPromptsFromGists();   // подгружаем все промпты из единого Gist (MD)
    // Внутренние функции — для тестов и отладки из консоли браузера
    Object.assign(window.editorState.fn, {
        updateLastSaveTimeLabel, recordDiskSave, setUiBusy, buildDsMessage, getPromptById,
        parsePromptsMarkdown, buildPromptsMarkdown, promptIdFromTitle, extractXmlFromText,
        renderReviewPanel, findAnswerIssues, buildTaskUrl, flagsString,
    });
});

function cacheElements() {
    const ids = [
        'quizName', 'flCheckMode', 'flShowHeader', 'flCrushMode',
        'xmlEditor', 'xmlPanel', 'resizer', 'editorContainer',
        'questionCard', 'questionNumber', 'qName', 'qShuffle', 'qNumbering', 'qText', 'fxBar',
        'answersContainer', 'questionTabs', 'prevBtn', 'nextBtn',
        // Навигация под окном предпросмотра (дубль навигации редактора)
        'pvNavBar', 'pvPrevBtn', 'pvNextBtn', 'pvQuestionTabs', 'pvQuestionNumber', 'previewCard',
        'statusText', 'statusMeta', 'toast', 'gistLinkContainer', 'publishedTaskLink',
        'loadModal', 'loadGistId', 'settingsModal', 'publishMenu', 'promptBar', 'promptText', 'publishCheckNote',
        'reviewPanel', 'reviewBody', 'reviewSummary', 'btnToggleReview',
        'dsModeSelect', 'btnManagePrompts', 'btnEditPrompt', 'btnCopyPrompt', 'btnReloadPrompt',
        'promptGistLink', 'lastSaveTimeLabel',
        'promptsModal', 'promptList', 'newPromptName', 'btnAddPrompt', 'promptsGistUrl',
        'btnReloadPrompts', 'btnSavePromptsToGist',
        'promptEditorModal', 'promptEditorArea', 'promptEditorInfo',
    ];
    els = {};
    ids.forEach(id => { els[id] = document.getElementById(id); });
    // Окно результата DeepSeek (когда ответ пришёл НЕ в виде XML) создаём динамически
    if (!document.getElementById('dsResultModal')) buildDsResultWindow();
    // Элементы вне стандартного списка (переключатель автосохранения в верхней панели)
    els.autoSaveToggle = document.getElementById('autoSaveToggle');
}

function bindEvents() {
    // Верхняя панель
    on('btnNewQuiz', 'click', newQuiz);
    on('btnPublishGist', 'click', () => { hidePublishMenu(); publishToGist(); });
    on('btnPublishGitverse', 'click', () => { hidePublishMenu(); publishToGitverse(); });
    on('btnLoadGist', 'click', showLoadModal);
    on('btnLoadDiskFile', 'click', loadFromDiskFile);
    on('btnSaveFile', 'click', saveToFile);
    on('btnPublish', 'click', (e) => { e.stopPropagation(); toggleMenu(els.publishMenu, null); });
    on('btnSettings', 'click', showSettingsModal);
    on('btnCopyXml', 'click', copyXml);
    on('btnApplyXml', 'click', applyXmlChanges);
    on('btnAskDeepSeek', 'click', () => askDeepSeek(currentDsMode()));

    // Ссылка на тест — в строке названия (над навигацией по вопросам)
    on('btnCopyTaskUrl', 'click', copyTaskUrl);
    on('btnOpenTaskTop', 'click', openTask);

    // Флаги теста — пересобираем ссылку на тест
    ['flCheckMode', 'flShowHeader', 'flCrushMode'].forEach(id => {
        els[id].addEventListener('change', updateGistLinkDisplay);
    });

    // Правая панель обзора вопросов (быстрое пролистывание всех вопросов)
    els.btnToggleReview.addEventListener('click', toggleReviewPanel);
    on('btnReviewClose', 'click', hideReviewPanel);

    // Панель промпта под окном XML: выбор режима (из единого Gist), редактор, копирование
    els.dsModeSelect.addEventListener('change', () => setDsMode(els.dsModeSelect.value));
    on('btnManagePrompts', 'click', showPromptsModal);
    on('btnEditPrompt', 'click', openPromptEditor);
    on('btnCopyPrompt', 'click', () => copyPrompt(currentDsMode()));
    on('btnReloadPrompt', 'click', reloadActivePromptFromGist);

    // Окно «Промпты DeepSeek» (все промпты в одном Gist, MD-формат)
    on('btnPromptsClose', 'click', hidePromptsModal);
    on('btnPromptsDone', 'click', hidePromptsModal);
    els.promptsModal.addEventListener('click', (e) => { if (e.target === els.promptsModal) hidePromptsModal(); });
    on('btnAddPrompt', 'click', addLocalPrompt);
    on('btnReloadPrompts', 'click', reloadAllPromptsFromGist);
    on('btnSavePromptsToGist', 'click', savePromptsToGist);
    els.promptsGistUrl.addEventListener('change', () => {
        localStorage.setItem(LS.promptsGist, els.promptsGistUrl.value.trim());
        updatePromptGistLink();
    });

    // Модальное окно текстового редактора активного промпта
    on('btnPromptEditorClose', 'click', hidePromptEditor);
    on('btnPromptEditorCancel', 'click', hidePromptEditor);
    on('btnPromptEditorSave', 'click', savePromptFromEditor);
    els.promptEditorModal.addEventListener('click', (e) => { if (e.target === els.promptEditorModal) hidePromptEditor(); });

    // Редактор вопроса
    els.qName.addEventListener('input', () => {
        currentQuestion().name = els.qName.value;
        updateXmlOutput();
        // Обновляем подсказки вкладок навигации (в т.ч. под предпросмотром) без перезаписи полей
        updateNavigation();
    });
    els.qText.addEventListener('input', () => {
        currentQuestion().text = els.qText.value;
        updateXmlOutput();
        schedulePreview();
    });
    els.qShuffle.addEventListener('change', () => {
        currentQuestion().shuffleanswers = els.qShuffle.value === 'true';
        updateXmlOutput();
    });
    els.qNumbering.addEventListener('change', () => {
        currentQuestion().answernumbering = els.qNumbering.value;
        updateXmlOutput();
        renderPreview();
    });
    els.quizName.addEventListener('input', () => {
        state.quizData.name = els.quizName.value;
        updateXmlOutput();
    });
    on('prevBtn', 'click', () => { prevQuestion(); scrollAfterQuestionChange(); });
    on('nextBtn', 'click', () => { nextQuestion(); scrollAfterQuestionChange(); });
    // Навигация под предпросмотром — то же пролистывание вопросов (быстрый просмотр)
    on('pvPrevBtn', 'click', () => { prevQuestion(); scrollAfterQuestionChange(); });
    on('pvNextBtn', 'click', () => { nextQuestion(); scrollAfterQuestionChange(); });
    on('btnAddQuestion', 'click', addQuestion);
    on('btnDuplicateQuestion', 'click', duplicateQuestion);
    on('btnDeleteQuestion', 'click', deleteCurrentQuestion);
    on('btnAddAnswer', 'click', addAnswer);

    // Панель вставки формул: вставка в последнее активное поле
    els.fxBar.querySelectorAll('.fx-btn').forEach(btn => {
        btn.addEventListener('click', () => ins(btn.dataset.before || '', btn.dataset.after || ''));
    });

    // Запоминаем последнее активное поле ввода — туда вставляются формулы
    document.addEventListener('focusin', (e) => {
        if (e.target.closest && e.target.closest('.editor-scroll-container') &&
            (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) {
            lastFocused = e.target;
        }
    });

    // XML-панель (ручное редактирование): изменения идут из XML — автосохраняем
    // на диск, но НЕ пересинхронизируем редактор -> XML (иначе рекурсия и потеря фокуса).
    els.xmlEditor.addEventListener('input', () => {
        if (applyingXmlToEditor) return;
        // Изменения в XML-окне: обновляем данные для проверки публикации и обзора.
        // Парсим «тихо»: при некорректном XML редактор не перерисовываем, а поле
        // ввода остаётся как есть (о пользователе уже предупреждает кнопка «Применить ▶»).
        silentParseXml(els.xmlEditor.value);
        updatePublishReadiness();
        if (!els.reviewPanel.classList.contains('hidden')) renderReviewPanel();
        state.dirty = true;
        scheduleAutoSave();
    });

    // Модальные окна
    on('btnLoadCancel', 'click', hideLoadModal);
    on('btnLoadConfirm', 'click', loadFromGist);
    els.loadModal.addEventListener('click', (e) => { if (e.target === els.loadModal) hideLoadModal(); });
    on('btnSettingsClose', 'click', hideSettingsModal);
    on('btnSettingsDone', 'click', hideSettingsModal);
    els.settingsModal.addEventListener('click', (e) => { if (e.target === els.settingsModal) hideSettingsModal(); });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideLoadModal(); hideSettingsModal(); hidePromptsModal(); hidePromptEditor(); hidePublishMenu();
        }
    });

    // Поля настроек (токены) + переключатель автосохранения в верхней панели
    ['githubToken', 'deepseekToken', 'gitverseToken'].forEach(id => {
        document.getElementById(id).addEventListener('change', saveSettings);
    });
    els.autoSaveToggle.addEventListener('change', () => {
        saveSettings();
        setStatus(autoSaveEnabled() ? 'Автосохранение на диск включено' : 'Автосохранение выключено');
    });

    // Меню публикации — закрытие по клику вне кнопок и самого меню
    document.addEventListener('click', (e) => {
        if (e.target.closest('#btnPublish') || e.target.closest('.publish-menu')) return;
        hideMenus();
    });
}

// Делегирование событий для динамически создаваемых вариантов ответов
document.addEventListener('input', (e) => {
    const t = e.target;
    const action = t.dataset && t.dataset.action;
    if (!action) return;
    const j = +t.dataset.a;
    const answers = currentQuestion().answers;
    if (action === 'update-answer') {
        answers[j].text = t.value;
    } else return;
    // force: поле принадлежит динамическому списку и перерисовывается только по явным
    // действиям (добавить/удалить), поэтому перезапись XML-панели не сбрасывает фокус
    updateXmlOutput({ force: true });
    schedulePreview();
});

document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const action = t.dataset.action;
    const q = state.quizData.questions[state.currentQuestionIndex];
    if (!q) return;
    const j = +t.dataset.a;

    switch (action) {
        case 'set-correct':
            q.answers.forEach((a, i) => { a.correct = i === j; });
            break;
        case 'remove-answer': {
            if (q.answers.length <= 2) { showToast('Минимум 2 варианта ответа', true); return; }
            q.answers.splice(j, 1);
            break;
        }
        default:
            return;
    }
    renderAnswers();
    renderPreview();
    updateXmlOutput();
});

function on(id, ev, fn) { document.getElementById(id).addEventListener(ev, fn); }

function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}
function escAttr(str) {
    return escHtml(str).replace(/"/g, '&quot;');
}

function currentQuestion() {
    return state.quizData.questions[state.currentQuestionIndex];
}

// ============================================================
// Настройки (токены, автосохранение) — в localStorage
// ============================================================
function loadSettings() {
    document.getElementById('githubToken').value = localStorage.getItem(LS.ghToken) || '';
    document.getElementById('deepseekToken').value = localStorage.getItem(LS.dsToken) || '';
    document.getElementById('gitverseToken').value = localStorage.getItem(LS.gvToken) || '';
    els.autoSaveToggle.checked = localStorage.getItem(LS.autoSave) === '1';
}

function saveSettings() {
    localStorage.setItem(LS.ghToken, document.getElementById('githubToken').value.trim());
    localStorage.setItem(LS.dsToken, document.getElementById('deepseekToken').value.trim());
    localStorage.setItem(LS.gvToken, document.getElementById('gitverseToken').value.trim());
    localStorage.setItem(LS.autoSave, els.autoSaveToggle.checked ? '1' : '0');
}

function getGithubToken() { return document.getElementById('githubToken').value.trim(); }
function getDeepseekToken() { return document.getElementById('deepseekToken').value.trim(); }
function getGitverseToken() { return document.getElementById('gitverseToken').value.trim(); }
function autoSaveEnabled() { return els.autoSaveToggle.checked; }
function autoSaveDelayMs() { return AUTOSAVE_DEBOUNCE_MS; }

// Активный режим DeepSeek = id промпта из state.prompts
function currentDsMode() { return localStorage.getItem(LS.dsMode) || 'formulas'; }
function setDsMode(mode) {
    localStorage.setItem(LS.dsMode, mode);
    renderModeSelect();
}

// Наполнение выпадающего списка режимов и показ текста активного промпта
function renderModeSelect() {
    const activeId = currentDsMode();
    if (els.dsModeSelect) {
        els.dsModeSelect.innerHTML = state.prompts
            .map(p => `<option value="${escHtml(p.id)}"${p.id === activeId ? ' selected' : ''}>${escHtml(p.name)}</option>`)
            .join('');
        // Если активного id ещё нет в списке — выбираем первый доступный
        if (state.prompts.length && !state.prompts.some(p => p.id === activeId)) {
            els.dsModeSelect.selectedIndex = 0;
            localStorage.setItem(LS.dsMode, state.prompts[0].id);
        }
    }
    const prompt = getPromptById(currentDsMode()) || state.prompts[0];
    if (document.activeElement !== els.promptText) {
        els.promptText.value = prompt ? prompt.text : '';
    }
    updatePromptGistLink();
}

function getPromptById(id) {
    return state.prompts.find(p => p.id === id) || null;
}

// Сохранение отредактированного пользователем промпта (для активного режима).
// Правки живут локально (localStorage) до «Сохранить все в Gist».
function savePromptEdit(text) {
    const id = currentDsMode();
    const p = getPromptById(id);
    if (!p) return;
    p.text = text;
    try {
        const edits = JSON.parse(localStorage.getItem(LS.promptEdits) || '{}');
        edits[id] = text;
        localStorage.setItem(LS.promptEdits, JSON.stringify(edits));
    } catch (e) { /* повреждённые данные — пропускаем */ }
}

// Кнопка «↻ Gist» — перезагрузить активный промпт из единого Gist (отменяет локальные правки)
async function reloadActivePromptFromGist() {
    const id = currentDsMode();
    const p = getPromptById(id);
    if (!p || p.source !== 'gist') {
        showToast('Этот промпт локальный — перезагрузка из Gist недоступна', true);
        return;
    }
    await loadPromptsFromGists({ only: id });
    setStatus('Промпт обновлён из Gist');
    showToast('Промпт «' + p.name + '» обновлён из Gist (правки отменены)');
}

// Ссылка на единый Gist со всеми промптами (под окном XML и в окне «Промпты»)
function getPromptsGistUrl() {
    return localStorage.getItem(LS.promptsGist) || DEFAULT_PROMPTS_GIST_URL;
}

function updatePromptGistLink() {
    const link = els.promptGistLink;
    if (!link) return;
    const url = getPromptsGistUrl();
    if (url) {
        link.href = url;
        link.textContent = 'Промпты на Gist ↗';
        link.classList.remove('hidden');
    } else {
        link.classList.add('hidden');
    }
}

// Полное сообщение для отправки в DeepSeek: активный промпт + XML из панели
function buildDsMessage(mode) {
    const p = getPromptById(mode) || state.prompts[0];
    const xml = els.xmlEditor.value || generateXml();
    return buildDsPrompt(p ? p.text : '') + '\n\nXML-ЗАДАНИЕ:\n' + xml;
}

// ============================================================
// XML: парсинг и генерация (Moodle XML, вопросы multichoice)
// ============================================================
// «Тихий» парсинг XML в состояние (без toast и без перерисовки редактора) —
// используется при живом редактировании XML-панели, чтобы проверка публикации
// и панель обзора видели актуальные данные.
function silentParseXml(xmlString) {
    applyingXmlToEditor = true;
    try {
        return parseXmlToDataQuiet(xmlString);
    } finally {
        applyingXmlToEditor = false;
    }
}

function parseXmlToData(xmlString) {
    const ok = parseXmlToDataQuiet(xmlString);
    if (!ok) showToast('Некорректный XML (нет вопросов типа multichoice)', true);
    return ok;
}

function parseXmlToDataQuiet(xmlString) {
    try {
        const doc = new DOMParser().parseFromString(xmlString || '<quiz/>', 'text/xml');
        if (doc.querySelector('parsererror')) throw new Error('Invalid XML');

        const qs = [];
        doc.querySelectorAll('question').forEach(node => {
            if ((node.getAttribute('type') || '') !== 'multichoice') return; // другие типы пропускаем

            const nameEl = node.querySelector(':scope > name > text');
            const qtEl = node.querySelector(':scope > questiontext > text');

            const answers = [];
            node.querySelectorAll(':scope > answer').forEach(a => {
                const tEl = a.querySelector(':scope > text');
                const frac = parseFloat(a.getAttribute('fraction') || '0');
                answers.push({ text: tEl ? tEl.textContent : '', correct: frac > 0 });
            });

            // Редактор рассчитан на один правильный ответ — оставляем первый
            let firstCorrect = true;
            answers.forEach(a => {
                if (a.correct) {
                    if (firstCorrect) firstCorrect = false; else a.correct = false;
                }
            });

            if (!answers.length) return;

            qs.push({
                name: nameEl ? nameEl.textContent : '',
                text: qtEl ? qtEl.textContent : '',
                shuffleanswers: (node.querySelector(':scope > shuffleanswers')?.textContent || 'true') !== 'false',
                answernumbering: node.querySelector(':scope > answernumbering')?.textContent || 'abc',
                answers,
            });
        });

        if (!qs.length) throw new Error('no multichoice questions');

        state.quizData.questions = qs;
        if (state.currentQuestionIndex >= qs.length) state.currentQuestionIndex = 0;
        return true;
    } catch (e) {
        return false;   // сообщение показывает вызвавший (parseXmlToData) или «тихий» режим
    }
}

function generateXml() {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<quiz>\n';
    state.quizData.questions.forEach(q => {
        xml += '    <question type="multichoice">\n';
        xml += `        <name>\n            <text>${escapeXml(q.name)}</text>\n        </name>\n`;
        xml += `        <questiontext format="html">\n            <text>${cdata(q.text)}</text>\n        </questiontext>\n`;
        xml += '        <generalfeedback format="html">\n            <text></text>\n        </generalfeedback>\n';
        xml += '        <defaultgrade>1.0</defaultgrade>\n';
        xml += '        <penalty>0.3333333</penalty>\n';
        xml += '        <hidden>0</hidden>\n';
        xml += '        <single>true</single>\n';
        xml += `        <shuffleanswers>${q.shuffleanswers ? 'true' : 'false'}</shuffleanswers>\n`;
        xml += `        <answernumbering>${escapeXml(q.answernumbering || 'abc')}</answernumbering>\n`;
        q.answers.forEach(a => {
            xml += `        <answer fraction="${a.correct ? '100' : '0'}" format="html">\n            <text>${cdata(a.text)}</text>\n        </answer>\n`;
        });
        xml += '    </question>\n';
    });
    xml += '</quiz>\n';
    return xml;
}

function escapeXml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Оборачивание в CDATA с защитой от последовательности ]]>
function cdata(str) {
    return '<![CDATA[' + String(str || '').replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>';
}

function newQuestion() {
    return {
        name: 'Вопрос',
        text: '<p></p>',
        shuffleanswers: true,
        answernumbering: 'abc',
        answers: [{ text: '', correct: true }, { text: '', correct: false }],
    };
}

// ============================================================
// Рендеринг редактора вопросов
// ============================================================
function renderAll() {
    renderQuestion();
    updateGistLinkDisplay();
    updatePublishReadiness();
}

function renderQuestion() {
    if (!state.quizData.questions.length) state.quizData.questions.push(newQuestion());
    if (state.currentQuestionIndex >= state.quizData.questions.length) {
        state.currentQuestionIndex = state.quizData.questions.length - 1;
    }
    const q = state.quizData.questions[state.currentQuestionIndex];

    els.questionNumber.textContent = state.currentQuestionIndex + 1;
    els.qName.value = q.name;
    els.qText.value = q.text;
    els.qShuffle.value = q.shuffleanswers ? 'true' : 'false';
    els.qNumbering.value = q.answernumbering || 'abc';

    renderAnswers();
    renderPreview();
    updateNavigation();
    els.statusMeta.textContent = 'Вопросов: ' + state.quizData.questions.length;
}

function renderAnswers() {
    const q = currentQuestion();
    if (!q.answers.length) {
        els.answersContainer.innerHTML = '<div class="empty-hint">Нет вариантов ответа.</div>';
        return;
    }
    els.answersContainer.innerHTML = q.answers.map((a, j) => `
        <div class="option-row ${a.correct ? 'correct' : ''}">
            <div class="radio ${a.correct ? 'selected' : ''}" data-action="set-correct" data-a="${j}" title="Отметить как правильный (fraction = 100)"></div>
            <span class="frac-badge ${a.correct ? 'frac-100' : 'frac-0'}">${a.correct ? '100%' : '0%'}</span>
            <textarea rows="1" class="opt-input" data-action="update-answer" data-a="${j}"
                placeholder="Текст ответа, может содержать \\(формулу\\)">${escHtml(a.text)}</textarea>
            <button type="button" class="btn-icon" data-action="remove-answer" data-a="${j}" title="Удалить ответ">&#10005;</button>
        </div>
    `).join('');
}

function letterFor(numbering, j) {
    const lower = 'abcdefghij', upper = 'ABCDEFGHIJ';
    if (numbering === 'ABC') return upper[j] || (j + 1);
    if (numbering === '123') return String(j + 1);
    if (numbering === 'none') return '•';
    return lower[j] || (j + 1);
}

function renderPreview() {
    const q = currentQuestion();
    const box = document.getElementById('previewBox');

    let html = `<div class="pv-question">${q.text || '<span class="hint">— текст вопроса пуст —</span>'}</div>`;
    html += q.answers.map((a, j) => {
        const L = letterFor(q.answernumbering, j);
        const label = q.answernumbering === 'none' ? L : L + '.';
        return `
        <div class="pv-answer ${a.correct ? 'pv-correct' : ''}">
            <span class="pv-letter">${label}</span>
            <span class="pv-text">${a.text || '—'}</span>
            ${a.correct ? '<span class="pv-check">✓ верно</span>' : ''}
        </div>`;
    }).join('');

    box.innerHTML = html;
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise([box]).catch(() => {});
    }
}

function schedulePreview() {
    clearTimeout(state.previewTimeout);
    state.previewTimeout = setTimeout(renderPreview, 350);
}

function updateNavigation() {
    els.prevBtn.disabled = state.currentQuestionIndex === 0;
    els.nextBtn.disabled = state.currentQuestionIndex >= state.quizData.questions.length - 1;
    els.questionTabs.innerHTML = state.quizData.questions.map((q, i) =>
        `<button type="button" class="nav-btn ${i === state.currentQuestionIndex ? 'active' : ''}" data-q="${i}" title="${escAttr(q.name)}">${i + 1}</button>`
    ).join('');
    els.questionTabs.querySelectorAll('button').forEach(b => {
        b.addEventListener('click', () => goToQuestion(+b.dataset.q));
    });

    // Дубль навигации под окном предпросмотра — позволяет быстро пролистывать
    // все вопросы в режиме предпросмотра, не возвращаясь к редактору.
    if (els.pvPrevBtn) els.pvPrevBtn.disabled = state.currentQuestionIndex === 0;
    if (els.pvNextBtn) els.pvNextBtn.disabled = state.currentQuestionIndex >= state.quizData.questions.length - 1;
    if (els.pvQuestionNumber) {
        els.pvQuestionNumber.textContent = state.currentQuestionIndex + 1;
    }
    if (els.pvQuestionTabs) {
        els.pvQuestionTabs.innerHTML = state.quizData.questions.map((q, i) =>
            `<button type="button" class="nav-btn ${i === state.currentQuestionIndex ? 'active' : ''}" data-q="${i}" title="${escAttr(q.name)}">${i + 1}</button>`
        ).join('');
        els.pvQuestionTabs.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => goToQuestion(+b.dataset.q));
        });
    }
}

// ============================================================
// Действия редактора
// ============================================================
function newQuiz() {
    if (state.dirty && !confirm('В текущем задании есть изменения. Создать новое задание без сохранения?')) return;
    state.quizData = { name: '', questions: [newQuestion()] };
    state.currentQuestionIndex = 0;
    els.quizName.value = '';
    renderQuestion();
    updateXmlOutput({ immediate: true });
    setStatus('Создано новое задание из шаблона');
    showToast('Создано новое задание из шаблона');
}

function addQuestion() {
    state.quizData.questions.push(newQuestion());
    state.currentQuestionIndex = state.quizData.questions.length - 1;
    renderQuestion();
    updateXmlOutput();
}

function duplicateQuestion() {
    const copy = JSON.parse(JSON.stringify(currentQuestion()));
    state.quizData.questions.splice(state.currentQuestionIndex + 1, 0, copy);
    state.currentQuestionIndex++;
    renderQuestion();
    updateXmlOutput();
    showToast('Вопрос продублирован');
}

function deleteCurrentQuestion() {
    if (state.quizData.questions.length <= 1) return showToast('Нельзя удалить последний вопрос', true);
    if (!confirm(`Удалить вопрос ${state.currentQuestionIndex + 1}?`)) return;
    state.quizData.questions.splice(state.currentQuestionIndex, 1);
    state.currentQuestionIndex = Math.min(state.currentQuestionIndex, state.quizData.questions.length - 1);
    renderQuestion();
    updateXmlOutput();
}

function prevQuestion() { if (state.currentQuestionIndex > 0) { state.currentQuestionIndex--; renderQuestion(); } }
function nextQuestion() { if (state.currentQuestionIndex < state.quizData.questions.length - 1) { state.currentQuestionIndex++; renderQuestion(); } }
function goToQuestion(i) { state.currentQuestionIndex = i; renderQuestion(); }

// Прокрутка после пролистывания: если видим карточку предпросмотра (например,
// листаем кнопками под предпросмотром) — скроллим к ней, иначе — к редактору вопроса.
function scrollAfterQuestionChange() {
    const pvVisible = els.previewCard && els.previewCard.offsetParent !== null;
    const target = pvVisible ? els.previewCard : els.questionCard;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('keydown', (e) => {
    // Alt+← / Alt+→ — быстрое пролистывание вопросов (в т.ч. в режиме предпросмотра).
    // В полях ввода срабатывает только по Alt, чтобы не мешать обычному тексту.
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const t = e.target;
    const inField = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.isContentEditable);
    if (inField && !e.altKey) return;
    // Не перехватываем стрелки, когда открыты модальные окна (класс .show)
    const modalOpen = ['settingsModal', 'loadModal', 'promptsModal', 'promptEditorModal', 'dsResultModal']
        .some(id => {
            const m = document.getElementById(id);
            return m && m.classList && m.classList.contains('show');
        });
    if (modalOpen) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') prevQuestion();
    else nextQuestion();
    scrollAfterQuestionChange();
});

function addAnswer() {
    currentQuestion().answers.push({ text: '', correct: false });
    renderAnswers();
    renderPreview();
    updateXmlOutput();
}

// ===== ВСТАВКА ФОРМУЛ =====
function ins(before, after) {
    const el = lastFocused;
    if (!el || !el.isConnected) return showToast('Сначала щёлкните в поле текста вопроса или ответа', true);
    const s = el.selectionStart ?? el.value.length;
    const e2 = el.selectionEnd ?? s;
    const sel = el.value.substring(s, e2);
    el.value = el.value.slice(0, s) + before + sel + after + el.value.slice(e2);
    el.focus();
    const pos = s + before.length + sel.length;
    el.selectionStart = el.selectionEnd = pos;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// ============================================================
// Синхронизация данных -> XML-панель + автосохранение на диск.
// Автосохранение срабатывает ТОЛЬКО при изменениях в задании
// (редактор вопросов / применение XML / ответ DeepSeek) — см. markTaskChanged().
// ============================================================
function updateXmlOutput(opts = {}) {
    clearTimeout(state.syncTimeout);
    const sync = () => {
        // Пока пользователь редактирует XML-панель — не перезаписываем её содержимое,
        // иначе теряются несохранённые ручные правки и сбрасывается каретка.
        if (document.activeElement === els.xmlEditor && !opts.force) return;
        els.xmlEditor.value = generateXml();
    };
    if (opts.immediate || opts.force) sync();
    else state.syncTimeout = setTimeout(sync, 100);

    // Индикатор готовности к публикации + панель обзора (если открыта)
    updatePublishReadiness();
    if (!els.reviewPanel.classList.contains('hidden')) renderReviewPanel();

    // Изменение В ЗАДАНИИ: помечаем как несохранённое и запускаем автосохранение
    if (!opts.silent) markTaskChanged();
}

// Единственная точка «в задании есть изменения»: dirty + автосохранение/предложение сохранить
function markTaskChanged() {
    state.dirty = true;
    scheduleAutoSave();
}

// Подпись под переключателем «Автосохранение»: время последнего сохранения файла на диск
function updateLastSaveTimeLabel() {
    const label = els.lastSaveTimeLabel;
    if (!label) return;
    const ts = parseInt(localStorage.getItem(LS.lastSaveTime) || '0', 10);
    if (ts) {
        const d = new Date(ts);
        label.textContent = 'Последнее сохранение: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
        label.classList.remove('hidden');
    } else {
        label.textContent = '';
        label.classList.add('hidden');
    }
}

// Фиксация факта успешного сохранения на диск (ручное или автосохранение)
function recordDiskSave() {
    localStorage.setItem(LS.lastSaveTime, String(Date.now()));
    updateLastSaveTimeLabel();
}

function scheduleAutoSave() {
    if (!autoSaveEnabled()) {
        // Автосохранение выключено — предлагаем сохранить файл вручную
        showSaveHint(true);
        return;
    }
    if (!state.fileHandle) {
        // Файл на диске ещё не выбран — НЕ скачиваем молча новые файлы
        // (это выглядело как «загрузка файла»). Просим выбрать файл один раз.
        showSaveHint(true);
        setStatus('Автосохранение: нажмите «💾 Сохранить в файл» и выберите файл на диске — изменения будут записываться в него автоматически');
        return;
    }
    setStatus('Автосохранение на диск…');
    clearTimeout(state.autoSaveTimeout);
    state.autoSaveTimeout = setTimeout(() => {
        state.autoSaveTimeout = null;
        autoSaveToDisk();
    }, autoSaveDelayMs());
}

// Подсветка кнопки «Сохранить в файл» + статусное предложение сохранить
function showSaveHint(show) {
    const btn = document.getElementById('btnSaveFile');
    if (btn) btn.classList.toggle('save-hint', !!show && state.dirty);
    if (show && !autoSaveEnabled() && state.dirty) {
        setStatus('Задание изменено — нажмите «💾 Сохранить в файл», чтобы записать его на диск');
    }
}

// Автосохранение выполняется ТОЛЬКО в выбранный файл на диске (File System Access API).
// Публикация на сервисы — только по кнопке «Публикация».
async function autoSaveToDisk() {
    const content = els.xmlEditor.value || generateXml();
    try {
        if (state.fileHandle && await ensureFilePermission(state.fileHandle)) {
            await writeFileHandle(state.fileHandle, content);
            state.dirty = false;
            showSaveHint(false);
            recordDiskSave();
            setStatus('Автосохранено на диск: ' + state.fileHandle.name + ' в ' + new Date().toLocaleTimeString());
            return;
        }
        // Доступ к файлу потерян (например, после перезагрузки страницы) —
        // просим выбрать файл заново, ничего без спроса не скачиваем.
        state.fileHandle = null;
        showSaveHint(true);
        setStatus('Автосохранение приостановлено: выберите файл через «💾 Сохранить в файл»');
    } catch (e) {
        setStatus('Ошибка автосохранения на диск: ' + e.message);
        showToast('Автосохранение: ' + e.message, true);
    }
}

async function ensureFilePermission(handle, requestWrite = true) {
    if (!handle || !handle.requestPermission) return true; // Firefox и т.п. — без API проверки
    try {
        const opts = { mode: 'readwrite' };
        let status = await handle.queryPermission(opts);
        if (status === 'granted') return true;
        if (!requestWrite) return false;
        status = await handle.requestPermission(opts);
        return status === 'granted';
    } catch (e) {
        return false;
    }
}

async function writeFileHandle(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
}

function downloadBlob(content, fileName, statusPrefix = 'Файл сохранён: ') {
    const blob = new Blob([content], { type: 'text/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(statusPrefix + fileName);
}

function suggestedFileName() {
    const base = (state.quizData.name || 'quiz')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim()
        .slice(0, 80) || 'quiz';
    return base.endsWith('.xml') ? base : base + '.xml';
}

// ============================================================
// Загрузка задания из файла на диске (File System Access API + fallback)
// Открытый файл становится «рабочим»: дальнейшие сохранения (ручные и
// автосохранение) пишутся именно в него, без повторных диалогов.
// ============================================================
async function loadFromDiskFile() {
    let handle = null;
    let content = null;
    let fileName = null;

    if (window.showOpenFilePicker) {
        // Стандартный выбор файла через File System Access API — сразу
        // получаем handle для последующей записи.
        try {
            [handle] = await window.showOpenFilePicker({
                multiple: false,
                types: [{ description: 'XML-задание', accept: { 'text/xml': ['.xml'], 'application/xml': ['.xml'] } }],
            });
        } catch (e) {
            if (e && e.name === 'AbortError') return;  // пользователь отменил
            // прочие ошибки — падаем на <input type=file>
        }
    }

    if (!handle) {
        // Firefox/Safari — обычный диалог открытия файла
        const picked = await pickFileViaInput();
        if (!picked) return;
        content = picked.content;
        fileName = picked.name;
    } else {
        if (!(await ensureFilePermission(handle, true))) {
            return showToast('Нет доступа на запись к выбранному файлу', true);
        }
        const fileObj = await handle.getFile();
        content = await fileObj.text();
        fileName = handle.name;
    }

    if (!content || !content.trim()) {
        return showToast('Файл пуст', true);
    }

    if (!parseXmlToData(content)) {
        return; // parseXmlToData уже показал ошибку разбора
    }

    // Файл становится целевым для сохранений
    state.fileHandle = handle;      // null в браузерах без FSAA — тогда сохранение через скачивание
    state.loadedFileName = fileName;
    state.currentQuestionIndex = 0;
    renderQuestion();
    updateXmlOutput({ immediate: true, silent: true });
    state.dirty = false;
    showSaveHint(false);
    setStatus('Загружен файл: ' + fileName +
        (handle ? ' — сохранения идут в него' : ' — сохранение будет через скачивание'));
    showToast('Файл «' + fileName + '» загружен (' + state.quizData.questions.length + ' вопр.) и назначен для сохранений');
}

// Fallback: стандартный <input type="file">
function pickFileViaInput() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.xml,text/xml,application/xml';
        input.style.display = 'none';
        document.body.appendChild(input);
        let settled = false;
        const finish = (val) => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(val);
        };
        input.addEventListener('change', async () => {
            const f = input.files && input.files[0];
            if (!f) return finish(null);
            finish({ name: f.name, content: await f.text() });
        });
        // Отмена диалога в некоторых браузерах отслеживается фокусом окна
        const onFocus = () => setTimeout(() => {
            if (!input.files || !input.files.length) finish(null);
            window.removeEventListener('focus', onFocus);
        }, 500);
        window.addEventListener('focus', onFocus);
        input.click();
    });
}

async function saveToFile() {
    const content = els.xmlEditor.value || generateXml();
    const fileName = state.loadedFileName || suggestedFileName();

    // Если файл на диске уже выбран — пишем прямо в него (стандартный механизм
    // File System Access API, без повторных диалогов)
    if (state.fileHandle && await ensureFilePermission(state.fileHandle)) {
        try {
            await writeFileHandle(state.fileHandle, content);
            state.dirty = false;
            showSaveHint(false);
            recordDiskSave();
            setStatus('Сохранено в файл: ' + state.fileHandle.name);
            showToast('Файл сохранён на диск');
            return;
        } catch (e) { /* падаем на диалог выбора файла */ }
    }

    // Диалог выбора места сохранения (Chrome/Edge). Файл запоминается —
    // дальше автосохранение пишет в него без вопросов.
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: fileName,
                types: [{ description: 'XML', accept: { 'text/xml': ['.xml'] } }],
            });
            await writeFileHandle(handle, content);
            state.fileHandle = handle;
            state.dirty = false;
            showSaveHint(false);
            recordDiskSave();
            setStatus('Сохранено в файл: ' + handle.name + (autoSaveEnabled() ? ' (автосохранение в него включено)' : ''));
            showToast('Файл выбран и сохранён — дальнейшие изменения пишутся в него');
            return;
        } catch (e) {
            if (e.name === 'AbortError') return; // пользователь отменил
            // прочие ошибки — падаем на download-fallback
        }
    }

    // Браузер без File System Access API (Firefox/Safari) — стандартное скачивание
    downloadBlob(content, fileName);
    state.dirty = false;
    showSaveHint(false);
    recordDiskSave();
    showToast('Файл сохранён на диск (скачан)');
}

// «Применить ▶»: XML -> редактор. После применения спрашиваем, в какой файл
// на диске сохранить задание (через стандартный диалог сохранения), и дальше
// работаем с этим файлом (в т.ч. автосохранение пишет в него).
function applyXmlChanges() {
    applyingXmlToEditor = true;
    let applied = false;
    try {
        applied = parseXmlToData(els.xmlEditor.value);
    } finally {
        applyingXmlToEditor = false;
    }
    if (!applied) return;
    state.currentQuestionIndex = 0;
    renderQuestion();
    // Информация из XML применена — изменения есть, предлагаем сохранить
    markTaskChanged();
    showToast('XML применён к редактору');
    confirmSaveAfterApply();
}

// Диалог «Сохранить применённое XML-задание в файл?» со стандартным выбором файла.
// Важно: window.confirm блокирует поток, поэтому showSaveFilePicker вызываем
// асинхронно (Promise + setTimeout) — иначе браузер отклоняет диалог как
// не инициированный пользователем.
function confirmSaveAfterApply() {
    Promise.resolve().then(() => {
        const ok = window.confirm('Информация из XML применена.\n\nСохранить задание в файл на диске?');
        if (!ok) {
            setStatus('Задание изменено, но не сохранено — нажмите «💾 Сохранить в файл», когда будете готовы');
            return;
        }
        setTimeout(() => saveToFile(), 0);   // покажет диалог выбора файла (или запишет в уже выбранный)
    });
}

function copyXml() {
    navigator.clipboard.writeText(els.xmlEditor.value);
    showToast('XML скопирован в буфер обмена');
}

// ============================================================
// Проверка готовности задания + панель «Обзор» (правая)
// ============================================================

/**
 * Индекс проблем с правильными ответами по всем вопросам:
 *  - вопросы multichoice без отмеченного правильного варианта (fraction = 100).
 */
function findAnswerIssues() {
    const issues = [];
    state.quizData.questions.forEach((q, qi) => {
        if (!q.answers.some(a => a.correct)) {
            issues.push({ question: qi, reason: 'не выбран правильный вариант' });
        }
    });
    return issues;
}

function isPublishReady() {
    return findAnswerIssues().length === 0;
}

// Обновление индикатора готовности рядом с кнопкой «Публикация»
function updatePublishReadiness() {
    const note = els.publishCheckNote;
    if (!note) return;
    const issues = findAnswerIssues();
    note.classList.toggle('hidden', issues.length === 0);
    if (issues.length) {
        note.textContent = '⚠ нет правильного ответа: ' + issues.length + ' вопр.';
    }
}

function toggleReviewPanel() {
    if (els.reviewPanel.classList.contains('hidden')) showReviewPanel();
    else hideReviewPanel();
}

function showReviewPanel() {
    renderReviewPanel();
    els.reviewPanel.classList.remove('hidden');
    els.btnToggleReview.classList.add('active');
}

function hideReviewPanel() {
    els.reviewPanel.classList.add('hidden');
    els.btnToggleReview.classList.remove('active');
}

// Быстрый пролистыватель всех вопросов с указанием правильного ответа;
// клик по карточке открывает нужный вопрос в редакторе.
function renderReviewPanel() {
    const body = els.reviewBody;
    let totalQuestions = 0, badQuestions = 0;

    body.innerHTML = state.quizData.questions.map((q, qi) => {
        totalQuestions++;
        const corr = q.answers.filter(a => a.correct).map(a => a.text.trim()).filter(Boolean);
        const ok = corr.length > 0;
        const correctText = ok ? '✔ ' + corr.join('; ') : '— правильный вариант не выбран';
        if (!ok) badQuestions++;
        return `<div class="review-item ${ok ? 'ok' : 'bad'}" data-q="${qi}" title="Открыть вопрос ${qi + 1} в редакторе">
            <div class="review-q"><span class="badge badge-choice">Multichoice</span> Q${qi + 1}: ${escHtml(q.name || '(без названия)')}</div>
            <div class="review-a ${ok ? '' : 'missing'}">${escHtml(correctText)}</div>
        </div>`;
    }).join('');

    if (!totalQuestions) body.innerHTML = '<div class="review-empty">В задании ещё нет вопросов.</div>';

    els.reviewSummary.textContent = totalQuestions
        ? (badQuestions ? '⚠ ' + badQuestions + ' из ' + totalQuestions + ' без ответа' : '✓ ' + totalQuestions + ' вопросов готово')
        : '';
    els.reviewSummary.classList.toggle('bad', badQuestions > 0);

    body.querySelectorAll('.review-item').forEach(item => {
        item.addEventListener('click', () => {
            goToQuestion(+item.dataset.q);
            // Подсветим карточку вопроса в редакторе
            const card = els.questionCard;
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                card.classList.add('flash-highlight');
                setTimeout(() => card.classList.remove('flash-highlight'), 1200);
            }
        });
    });

    // Формулы в правильных ответах тоже рендерим
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise([body]).catch(() => {});
    }
}

// ============================================================
// Публикация: GitHub Gist / GitVerse (только по кнопке, возвращает ссылку)
// ============================================================
function toggleMenu(menu, otherMenu) {
    const willShow = menu.classList.contains('hidden');
    if (otherMenu) otherMenu.classList.add('hidden');
    menu.classList.toggle('hidden', !willShow);
}
function hidePublishMenu() { els.publishMenu.classList.add('hidden'); }
function hideMenus() {
    els.publishMenu.classList.add('hidden');
}

// Публикация в Gist: если GIST уже привязан — обновляем его, иначе создаём новый.
// Перед публикацией — проверка: у всех вопросов должен быть выбран правильный ответ.
function publishToGist() {
    if (!checkBeforePublish()) return;
    if (state.gistId) return saveToGist();
    return createNewGist();
}

// Проверка готовности к публикации; при проблемах — открываем панель обзора
// и показываем список проблемных вопросов. Возвращает true, если публиковать можно.
function checkBeforePublish() {
    const issues = findAnswerIssues();
    if (!issues.length) return true;
    showReviewPanel();
    const list = issues.slice(0, 8)
        .map(i => `Q${i.question + 1} — ${i.reason}`)
        .join('\n') + (issues.length > 8 ? `\n…и ещё ${issues.length - 8}` : '');
    showToast('Публикация невозможна: не у всех вопросов выбран правильный ответ (' + issues.length + ')', true);
    setStatus('Проверка перед публикацией: ' + issues.length + ' вопрос(ов) без правильного ответа: ' + list.replace(/\n/g, ' · '));
    alert('Перед публикацией нужно выбрать правильный ответ во всех вопросах.\n\nПроблемные вопросы:\n' + list + '\n\nОни отмечены красным в панели «Обзор» справа.');
    return false;
}

function openExternal(url) { window.open(url, '_blank', 'noopener'); }

// Ссылка на тест — показывается в строке названия теста: ссылка + копировать + открыть.
function updateGistLinkDisplay() {
    const link = buildTaskUrl();
    if (link) {
        els.publishedTaskLink.href = link;
        els.publishedTaskLink.textContent = link;
        els.gistLinkContainer.classList.remove('hidden');
    } else {
        els.gistLinkContainer.classList.add('hidden');
    }
}

// Копирование ссылки на тест (кнопки рядом со ссылкой)
function copyTaskUrl() {
    const link = buildTaskUrl();
    if (!link) return showToast('Задание ещё не опубликовано', true);
    navigator.clipboard.writeText(link);
    showToast('Ссылка на тест скопирована');
}

async function createNewGist() {
    const token = getGithubToken();
    if (!token) return showToast('Укажите GitHub Token (⚙ Настройки)', true);

    try {
        setStatus('Создание нового GIST…');
        const res = await fetch('https://api.github.com/gists', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: state.quizData.name || 'Moodle XML Quiz',
                public: false,
                files: { [GIST_FILENAME]: { content: els.xmlEditor.value || generateXml() } },
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        state.gistId = data.id;
        state.gistUrl = data.html_url;
        state.gistFilename = GIST_FILENAME;
        state.rawUrl = data.files[GIST_FILENAME]?.raw_url || null;
        state.lastPublishTarget = 'gist';
        state.dirty = false;

        updateGistLinkDisplay();
        showPublishedLink('GIST опубликован', buildTaskUrl());
    } catch (e) {
        setStatus('Ошибка создания GIST: ' + e.message);
        showToast('Создание не удалось: ' + e.message, true);
    }
}

// Флаги приложения тестирования из чекбоксов строки названия
function flagsString() {
    return (els.flCheckMode.checked ? '&checkmode=true' : '') +
        (els.flShowHeader.checked ? '&headershow=true' : '') +
        (els.flCrushMode.checked ? '&crushmode=true' : '');
}

// Ссылка на тест в приложении тестирования (открывается по raw-ссылке XML; Gist или GitVerse)
function buildTaskUrl() {
    let raw = null;
    if (state.lastPublishTarget === 'gitverse' && state.gitverseRawUrl) {
        raw = state.gitverseRawUrl;
    } else {
        raw = state.rawUrl;
    }
    if (!raw) return state.gistUrl || '';
    return TEST_APP_BASE_URL + '?name=' + encodeURIComponent(raw) + flagsString();
}

// Показать ссылку на тест после публикации: статус + toast + копирование в буфер
function showPublishedLink(title, link) {
    setStatus(`${title}. Ссылка скопирована в буфер обмена`);
    showToast(`${title}: ${link}`, false);
    if (link && navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
}

// ============================================================
// Публикация на сервис (GitHub Gist / GitVerse) — только по кнопке.
// saveToGist вызывается из «Открыть тест» для синхронизации перед открытием.
// ============================================================
async function saveToGist(opts = {}) {
    const token = getGithubToken();
    if (!state.gistId || !token) return;
    if (state.isSaving) { state.needsAnotherSave = true; return; }
    state.isSaving = true;

    setStatus('Сохранение в GIST…');
    try {
        const res = await fetch(`https://api.github.com/gists/${state.gistId}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                description: state.quizData.name || 'Moodle XML Quiz',
                files: { [state.gistFilename]: { content: els.xmlEditor.value } },
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        const fd = data.files[state.gistFilename];
        if (fd && fd.raw_url) state.rawUrl = fd.raw_url;
        // Публикация не сбрасывает «несохранённость» файла на диске:
        // dirty остаётся, пока изменения не записаны на диск.
        setStatus('Обновлено в GIST в ' + new Date().toLocaleTimeString());
        if (!opts.silent) showPublishedLink('Обновлено в GIST', buildTaskUrl());
    } catch (e) {
        setStatus('Ошибка сохранения в GIST: ' + e.message);
        if (!opts.silent) showToast('Публикация не удалась: ' + e.message, true);
    } finally {
        state.isSaving = false;
        if (state.needsAnotherSave) {
            state.needsAnotherSave = false;
            saveToGist(opts);
        }
    }
}

async function publishToGitverse(opts = {}) {
    if (!checkBeforePublish()) return;
    const token = getGitverseToken();
    if (!token) {
        showToast('Укажите токен GitVerse в настройках (⚙)', true);
        return;
    }
    const content = els.xmlEditor.value || generateXml();
    const fileName = suggestedFileName();
    const projectName = (localStorage.getItem('gv_project') || '').trim();

    try {
        setStatus('Публикация на GitVerse…');
        const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' };

        // 1. Найти репозиторий для публикации
        let project = projectName;
        if (!project) {
            const resList = await fetch(`${GITVERSE_API}/user/repos?per_page=100`, { headers });
            if (!resList.ok) throw new Error(await describeHttpError(resList));
            const list = await resList.json();
            const items = Array.isArray(list) ? list : (list.items || list.data || []);
            // Приоритет: репозиторий для moodle/quiz-тестов, иначе первый доступный
            const preferred = items.find(p => /moodle|quiz|test/i.test(p.path || p.name || '')) || items[0];
            if (!preferred) throw new Error('На GitVerse нет ни одного репозитория — создайте любой и повторите');
            project = preferred.path || preferred.full_path || preferred.name;
            localStorage.setItem('gv_project', project);
        }

        // 2. Проверка существования файла (нужен blob_id для обновления)
        let branch = 'master';
        let existingBlob = null;
        const resFile = await fetch(`${GITVERSE_API}/repos/${project}/contents/${encodeURIComponent(fileName)}`, { headers });
        if (resFile.ok) {
            const info = await resFile.json();
            existingBlob = info.blob_id || info.sha || null;
            if (info.branch) branch = info.branch;
        } else if (resFile.status !== 404) {
            // не 404 — попробуем прочитать описание ошибки; если тело недоступно — бросаем статус
            let detail = '';
            try { detail = await describeHttpError(resFile); } catch (e2) { /* ignore */ }
            throw new Error(`HTTP ${resFile.status}${detail ? ': ' + detail : ''}`);
        }

        // 3. Создать или обновить файл
        const body = {
            content: btoaUtf8(content),
            commit_message: `${existingBlob ? 'Обновление' : 'Публикация'} теста: ${state.quizData.name || fileName}`,
            branch,
        };
        if (existingBlob) body.blob_id = existingBlob;

        const res = await fetch(`${GITVERSE_API}/repos/${project}/contents/${encodeURIComponent(fileName)}`, {
            method: existingBlob ? 'PUT' : 'POST',
            headers,
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await describeHttpError(res));

        state.gitverseProject = project;
        state.gitverseRawUrl = `https://gitverse.ru/${project}/raw/branch/${branch}/${encodeURIComponent(fileName)}`;
        state.lastPublishTarget = 'gitverse';

        updateGistLinkDisplay();
        // Ссылка на тест: приложение тестирования открывает XML по raw-ссылке GitVerse
        const taskLink = buildTaskUrl();
        showPublishedLink('Опубликовано на GitVerse (' + project + ')', taskLink);
    } catch (e) {
        setStatus('Ошибка публикации на GitVerse: ' + e.message);
        showToast('GitVerse: ' + e.message, true);
    }
}

function btoaUtf8(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}

async function describeHttpError(res) {
    if (!res || typeof res.text !== 'function') return res && res.status ? `HTTP ${res.status}` : '';
    let detail = '';
    try {
        const text = await res.text();
        try { const j = JSON.parse(text); detail = j.message || j.error || text.slice(0, 120); }
        catch (e) { detail = text.slice(0, 120); }
    } catch (e) { /* ignore */ }
    return `HTTP ${res.status}${detail ? ': ' + detail : ''}`;
}

async function openTask() {
    // Если GIST не привязан, но есть GitVerse-публикация — открываем ссылку на тест
    if (!state.gistId && state.gitverseRawUrl) {
        const taskUrl = buildTaskUrl();
        navigator.clipboard.writeText(taskUrl).catch(() => {});
        openExternal(taskUrl);
        showToast('Ссылка на тест скопирована и открыта');
        return;
    }
    if (!state.gistId) return showToast('Сначала опубликуйте задание (Gist или GitVerse)', true);

    copyTaskUrl();
    // Открываем окно синхронно (иначе блокировщик всплывающих окон), затем сохраняем изменения
    const win = window.open('about:blank', '_blank');
    try {
        if (state.dirty) {
            clearTimeout(state.autoSaveTimeout);
            state.autoSaveTimeout = null;
            await saveToGist({ silent: true });
        }
    } catch (e) { /* продолжаем даже при ошибке сохранения */ }

    if (!state.rawUrl) {
        if (win) win.close();
        return showToast('Raw-ссылка недоступна', true);
    }

    const taskUrl = buildTaskUrl();
    navigator.clipboard.writeText(taskUrl);
    if (win) { win.opener = null; win.location.href = taskUrl; }
    else { window.open(taskUrl, '_blank'); }
    showToast('Ссылка на тест скопирована и открыта');
}

// ============================================================
// Загрузка из Gist
// ============================================================
function extractGistId(input) {
    input = (input || '').trim();
    if (!input) return null;
    try {
        const u = new URL(input);
        const f = u.searchParams.get('file') || u.searchParams.get('name');
        if (f) input = f;
    } catch (e) { /* не URL */ }
    const m = input.match(/(?:gist\.github\.com|gist\.githubusercontent\.com)\/(?:[^/\s]+\/)?([0-9a-f]{7,})/i);
    if (m) return m[1];
    if (/^[0-9a-f]{7,}$/i.test(input)) return input;
    return null;
}

async function loadFromGist() {
    const token = getGithubToken();
    const input = els.loadGistId.value.trim();
    if (!token || !input) return showToast('Нужны GitHub Token и ссылка на GIST', true);

    const id = extractGistId(input);
    if (!id) return showToast('Не удалось определить ID GIST', true);

    try {
        setStatus('Загрузка GIST…');
        const res = await fetch(`https://api.github.com/gists/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);

        let fileName = null;
        if (data.files[GIST_FILENAME]) {
            fileName = GIST_FILENAME;
        } else {
            const names = Object.keys(data.files);
            fileName = names.find(n => n.toLowerCase().endsWith('.xml')) || names[0];
        }
        const file = data.files[fileName];
        if (!file) throw new Error('В GIST нет файлов');

        if (parseXmlToData(file.content)) {
            state.gistId = data.id;
            state.gistUrl = data.html_url || `https://gist.github.com/${id}`;
            state.gistFilename = fileName;
            state.rawUrl = file.raw_url || null;
            state.lastPublishTarget = 'gist';

            // Название теста берём из описания GIST (если это не подпись по умолчанию)
            state.quizData.name = data.description &&
                !['Moodle XML Quiz', 'Reading Test'].includes(data.description)
                ? data.description : '';
            els.quizName.value = state.quizData.name;

            updateGistLinkDisplay();
            state.currentQuestionIndex = 0;
            renderQuestion();
            updateXmlOutput({ immediate: true, silent: true });
            state.dirty = false;
            showSaveHint(false);
            hideLoadModal();
            setStatus('GIST загружен: ' + state.quizData.questions.length + ' вопр.');
            showToast('GIST загружен');
        } else {
            setStatus('Готово');
        }
    } catch (e) {
        setStatus('Ошибка загрузки: ' + e.message);
        showToast('Загрузка не удалась: ' + e.message, true);
    }
}

// ============================================================
// Промпты DeepSeek — универсальная работа.
// Все промпты (включая добавленные пользователем) хранятся в ОДНОМ
// GitHub Gist в формате Markdown: каждый промпт — секция «## Название».
// Режимы DeepSeek = промпты из этого списка; пользователь может добавить свои.
// Текст берётся из окна XML, результат возвращается в окно XML.
// Без токена: копируем промпт+XML и открываем чат DeepSeek.
// ============================================================

// Ссылка на единый Gist со всеми промптами (MD). Можно переопределить в окне «📝 Промпты…».
const DEFAULT_PROMPTS_GIST_URL = 'https://gist.github.com/tregubovvn/2f9804a3ad5439b1bb60957b8969826a';

// Два ОСНОВНЫХ промпта Moodle-редактора — обязательная основа режимов DeepSeek.
// Текст каждого берётся напрямую с указанных gist'ов (всегда актуальная версия):
//   Тесты с формулами — https://gist.github.com/tregubovvn/5abee72a0846a0481506b5947e0fb270
//   Создание задач    — https://gist.github.com/tregubovvn/0637360f442f65ed457f133096a3c4b3
const BUILTIN_PROMPTS = [
    { id: 'formulas', name: 'Тесты с формулами', gistUrl: 'https://gist.github.com/tregubovvn/5abee72a0846a0481506b5947e0fb270' },
    { id: 'tasks', name: 'Создание задач', gistUrl: 'https://gist.github.com/tregubovvn/0637360f442f65ed457f133096a3c4b3' },
];

// Конец сообщения модели — этим блоком модель подтверждает, что задание
// готово полностью; если его нет, просим модель продолжить.
const READY_MARKER = '[MOODLE-XML-READY]';

// Добавляем к промпту технические требования к формату ответа
function buildDsPrompt(basePrompt) {
    return (basePrompt || '').trim() + '\n\n' +
        'ТЕХНИЧЕСКИЕ ТРЕБОВАНИЯ К ОТВЕТУ:\n' +
        '1. Входные данные — XML-файл теста Moodle (приведён после этого промпта).\n' +
        '2. Ответь ТОЛЬКО полным готовым XML (<quiz>...</quiz>) без пояснений и без блоков markdown.\n' +
        '3. Сохрани структуру Moodle XML: вопросы type="multichoice", обёртки CDATA,\n' +
        '   LaTeX-формулы в виде \\( ... \\) (строчные) и \\[ ... \\] (выносные).\n' +
        '4. Последней строкой ответа добавь точный маркер: ' + READY_MARKER;
}

async function fetchGistRaw(url) {
    const m = url.match(/(?:gist\.github\.com|gist\.githubusercontent\.com)\/(?:[^/\s]+\/)?([0-9a-f]{7,})/i);
    if (!m) throw new Error('Некорректная ссылка на Gist: ' + url);
    const res = await fetch('https://api.github.com/gists/' + m[1]);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' при загрузке Gist');
    const data = await res.json();
    const files = Object.values(data.files || {});
    if (!files.length) throw new Error('В Gist нет файлов');
    // предпочитает .md/.txt, иначе первый файл
    const preferred = files.find(f => /\.(md|txt)$/i.test(f.filename)) || files[0];
    const rawRes = await fetch(preferred.raw_url);
    if (!rawRes.ok) throw new Error('HTTP ' + rawRes.status + ' при чтении файла Gist');
    return await rawRes.text();
}

// --- MD-формат единого файла промптов -------------------------------------
// Разбирает MD-текст на промпты по заголовкам верхнего уровня «## Название».
// Первый заголовок уровня 1 (# ...) — название набора, игнорируется.
function parsePromptsMarkdown(md) {
    const list = [];
    const lines = (md || '').split(/\r?\n/);
    let cur = null;
    for (const line of lines) {
        const h = line.match(/^##\s+(.+?)\s*$/);
        if (h) {
            if (cur && cur.body.trim()) list.push(cur);
            cur = { title: h[1].trim(), body: '' };
            continue;
        }
        if (cur) cur.body += line + '\n';
    }
    if (cur && cur.body.trim()) list.push(cur);
    return list.map(item => ({
        id: promptIdFromTitle(item.title),
        name: item.title,
        text: item.body.trim(),
        source: 'gist',
    }));
}

// Генерирует единый MD-файл из текущего списка промптов (для сохранения в Gist)
function buildPromptsMarkdown(prompts) {
    const header = '# Промпты для редактора Moodle XML\n\n' +
        'Каждая секция «## Название» — отдельный промпт (режим DeepSeek).\n' +
        'Редактируйте прямо здесь или в редакторе тестов кнопкой «📝 Промпты…» → «💾 Сохранить все в Gist».\n';
    return header + prompts.map(p => '\n## ' + p.name + '\n\n' + (p.text || '(пусто)') + '\n').join('\n---\n');
}

// Стабильный id промпта по названию (кириллица разрешена)
function promptIdFromTitle(title) {
    const slug = (title || '').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return slug || ('prompt-' + Math.random().toString(36).slice(2, 8));
}

// Загрузка ВСЕХ промптов из единого Gist (MD). Локальные правки (promptEdits)
// имеют приоритет над текстом из Gist; локальные (пользовательские) промпты
// всегда остаются в списке. opts.only — обновить только промпт с этим id.
async function loadPromptsFromGists(opts = {}) {
    setStatus('Загрузка промптов с GitHub Gist…');
    let edits = {};
    try { edits = JSON.parse(localStorage.getItem(LS.promptEdits) || '{}'); } catch (e) { edits = {}; }

    const localPrompts = state.prompts.filter(p => p.source === 'local');

    // 1. ДВА ОСНОВНЫХ промпта — обязательная основа: текст всегда берётся
    //    напрямую со ссылок gist'ов из BUILTIN_PROMPTS (актуальная версия).
    const builtins = await Promise.all(BUILTIN_PROMPTS.map(async (b) => {
        let text = '';
        try { text = (await fetchGistRaw(b.gistUrl)).trim(); }
        catch (e) { console.warn('Не удалось загрузить основной промпт «' + b.name + '»:', e); }
        return { id: b.id, name: b.name, text, source: 'gist', gistUrl: b.gistUrl };
    }));

    // 2. Единый Gist со всеми (в т.ч. пользовательскими) промптами в MD-формате
    //    (секции «## Название»). Основные режимы оттуда не дублируем.
    let gistPrompts = [];
    try {
        const md = await fetchGistRaw(getPromptsGistUrl());
        gistPrompts = parsePromptsMarkdown(md)
            .filter(p => !BUILTIN_PROMPTS.some(b => b.id === p.id));
    } catch (e) {
        console.warn('Не удалось загрузить единый Gist промптов:', e);
    }

    // Порядок: основные режимы первыми, затем остальные из Gist, затем локальные
    const ordered = [...builtins.filter(p => p.text), ...gistPrompts];

    if (opts.only) {
        // Обновляем только один промпт: основной — всегда с его gist-ссылки,
        // остальные — из единого MD-Gist; локальная правка отменяется.
        const builtin = BUILTIN_PROMPTS.find(b => b.id === opts.only);
        let fresh = null;
        if (builtin) {
            try { fresh = { text: (await fetchGistRaw(builtin.gistUrl)).trim() }; }
            catch (e) { showToast('Не удалось загрузить промпт «' + builtin.name + '»: ' + e.message, true); return; }
        } else {
            fresh = ordered.find(p => p.id === opts.only);
        }
        if (fresh) {
            const existing = getPromptById(opts.only);
            if (existing) {
                existing.text = fresh.text || existing.text;
                if (fresh.name) existing.name = fresh.name;
                existing.source = 'gist';
            }
            else state.prompts.push(fresh);
            // Правка в localStorage больше не должна перекрывать свежий текст
            delete edits[opts.only];
            localStorage.setItem(LS.promptEdits, JSON.stringify(edits));
        }
    } else {
        // Основные промпты всегда присутствуют в списке (даже при пустом тексте —
        // чтобы режим был виден и его можно было перезагрузить кнопкой «↻ Gist»);
        // остальные промпты: сначала уже известные (с сохранением порядка),
        // затем новые из единого MD-Gist, затем локальные пользовательские.
        const known = state.prompts.filter(p => !BUILTIN_PROMPTS.some(b => b.id === p.id) && p.source !== 'local');
        const extras = gistPrompts.filter(p => !known.some(q => q.id === p.id));
        state.prompts = [...builtins, ...known, ...extras, ...localPrompts];
    }

    // Восстанавливаем локальные правки поверх загруженных текстов
    for (const p of state.prompts) {
        if (typeof edits[p.id] === 'string' && edits[p.id].trim()) p.text = edits[p.id];
    }

    renderModeSelect();
    if (!els.promptsModal.classList.contains('show')) { /* окно промптов закрыто — достаточно */ }
    else renderPromptList();
    const okCount = state.prompts.filter(p => p.text).length;
    if (okCount === state.prompts.length && okCount > 0) setStatus('Готово: ' + okCount + ' промпт(ов) загружено из Gist');
    else if (okCount > 0) setStatus('Готово: ' + okCount + ' из ' + state.prompts.length + ' промптов имеют текст («↻ Gist» или редактор промпта)');
    else setStatus('Промпты с Gist не загрузились — нажмите «↻ Gist» или отредактируйте промпт вручную');
}

// Перезагрузка всех промптов из Gist (кнопка в окне «Промпты…») — отменяет правки
async function reloadAllPromptsFromGist() {
    localStorage.setItem(LS.promptEdits, '{}');   // отменяем локальные правки текстов
    await loadPromptsFromGists();
    renderPromptList();
    showToast('Все промпты перезагружены из Gist');
}

// --- Окно «Промпты DeepSeek» ------------------------------------------------
function showPromptsModal() {
    els.promptsGistUrl.value = getPromptsGistUrl();
    renderPromptList();
    els.promptsModal.classList.add('show');
}
function hidePromptsModal() {
    els.promptsModal.classList.remove('show');
    renderModeSelect();
}

function renderPromptList() {
    els.promptList.innerHTML = state.prompts.map(p => `
        <li class="prompt-item${p.id === currentDsMode() ? ' active' : ''}" data-id="${escHtml(p.id)}">
            <div class="prompt-item-main">
                <span class="prompt-item-name">${p.source === 'gist' ? '☁' : '📝'} ${escHtml(p.name)}</span>
                <span class="prompt-item-meta">${p.source === 'gist' ? 'из Gist' : 'локальный'} · ${(p.text || '').length} симв.</span>
            </div>
            <div class="prompt-item-actions">
                <button type="button" class="btn btn-sm btn-ghost" data-action="edit" title="Открыть в текстовом редакторе">✎</button>
                ${p.source === 'local' ? '<button type="button" class="btn btn-sm btn-ghost" data-action="remove" title="Удалить локальный промпт">✕</button>' : ''}
            </div>
        </li>`).join('') || '<li class="hint">Промпты не загружены — «↻ Загрузить из Gist».</li>';

    els.promptList.querySelectorAll('.prompt-item').forEach(li => {
        const id = li.dataset.id;
        li.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action === 'edit') { setDsMode(id); openPromptEditor(); return; }
            if (action === 'remove') { removePrompt(id); return; }
            setDsMode(id);          // выбор режима кликом по строке
            renderPromptList();
        });
    });
}

// Добавление своего (локального) промпта
function addLocalPrompt() {
    const name = els.newPromptName.value.trim();
    if (!name) { showToast('Введите название промпта', true); return; }
    let id = promptIdFromTitle(name);
    if (getPromptById(id)) id = id + '-' + Date.now().toString(36);
    state.prompts.push({ id, name, text: '', source: 'local' });
    els.newPromptName.value = '';
    setDsMode(id);
    renderPromptList();
    openPromptEditor();   // сразу предлагаем написать текст
    showToast('Промпт «' + name + '» добавлен. Напишите его текст и сохраните.');
}

function removePrompt(id) {
    const idx = state.prompts.findIndex(p => p.id === id);
    if (idx === -1) return;
    const [removed] = state.prompts.splice(idx, 1);
    const edits = JSON.parse(localStorage.getItem(LS.promptEdits) || '{}');
    delete edits[id];
    localStorage.setItem(LS.promptEdits, JSON.stringify(edits));
    if (currentDsMode() === id) setDsMode(state.prompts[0]?.id || 'formulas');
    renderPromptList();
    renderModeSelect();
    showToast('Промпт «' + removed.name + '» удалён');
}

// Сохранение ВСЕХ промптов обратно в тот же самый Gist (MD-файл)
async function savePromptsToGist() {
    const token = getGithubToken();
    if (!token) { showToast('Нужен GitHub Token (⚙ Настройки)', true); return; }
    const url = els.promptsGistUrl.value.trim() || getPromptsGistUrl();
    const md = buildPromptsMarkdown(state.prompts);
    setStatus('Сохранение промптов в Gist…');
    try {
        const gistIdMatch = url.match(/(?:gist\.github\.com|gist\.githubusercontent\.com)\/(?:[^/\s]+\/)?([0-9a-f]{7,})/i);
        let res;
        if (gistIdMatch) {
            // Обновляем существующий Gist: заменяем MD-файл (или добавляем новый)
            const cur = await (await fetch('https://api.github.com/gists/' + gistIdMatch[1], {
                headers: { Authorization: `Bearer ${token}` },
            })).json();
            const oldFilename = Object.keys(cur.files || {})[0] || 'prompts.md';
            res = await fetch('https://api.github.com/gists/' + gistIdMatch[1], {
                method: 'PATCH',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: { 'prompts.md': { content: md }, ...(oldFilename !== 'prompts.md' ? { [oldFilename]: null } : {}) } }),
            });
        } else {
            // Новый Gist — создаём и запоминаем ссылку
            res = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ description: 'Промпты для редактора Moodle XML', public: false, files: { 'prompts.md': { content: md } } }),
            });
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err.message) || 'HTTP ' + res.status);
        }
        const data = await res.json();
        const newUrl = data.html_url || url;
        localStorage.setItem(LS.promptsGist, newUrl);
        els.promptsGistUrl.value = newUrl;
        updatePromptGistLink();
        // После записи в Gist локальные правки больше не нужны — текст уже там
        localStorage.setItem(LS.promptEdits, '{}');
        state.prompts.forEach(p => { if (p.source === 'local') p.source = 'gist'; });
        renderPromptList();
        setStatus('Промпты сохранены в Gist: ' + newUrl);
        showToast('Все промпты сохранены в Gist');
    } catch (e) {
        setStatus('Ошибка сохранения промптов: ' + e.message);
        showToast('Сохранение промптов: ' + e.message, true);
    }
}

// --- Модальное окно текстового редактора активного промпта ------------------
function openPromptEditor() {
    const p = getPromptById(currentDsMode());
    if (!p) { showToast('Сначала выберите или добавьте промпт', true); return; }
    els.promptEditorArea.value = p.text || '';
    els.promptEditorInfo.textContent =
        'Промпт: «' + p.name + '» (' + (p.source === 'gist' ? 'из Gist' : 'локальный') + '). ' +
        'Правка сохраняется в браузере; чтобы записать её в Gist — «📝 Промпты…» → «💾 Сохранить все в Gist».';
    els.promptEditorModal.classList.add('show');
    els.promptEditorArea.focus();
}
function hidePromptEditor() { els.promptEditorModal.classList.remove('show'); }

function savePromptFromEditor() {
    savePromptEdit(els.promptEditorArea.value);
    renderModeSelect();
    if (els.promptsModal.classList.contains('show')) renderPromptList();
    hidePromptEditor();
    showToast('Промпт сохранён (локально). Для записи в Gist — «💾 Сохранить все в Gist»');
}

function extractXmlFromText(text) {
    if (!text) return '';
    // убираем markdown-обёртки ```xml ... ```
    const fenced = text.match(/```(?:xml)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('<quiz');
    const end = candidate.lastIndexOf('</quiz>');
    if (start !== -1 && end !== -1) return candidate.slice(start, end + '</quiz>'.length).trim();
    return candidate.trim();
}

// Отправка одного сообщения в DeepSeek; возвращает текст ответа модели.
async function deepseekChat(token, messages) {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages, stream: false }),
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* не-JSON ответ */ }
    if (!res.ok) {
        throw new Error((data && (data.error?.message || data.message)) || 'HTTP ' + res.status);
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Некорректный ответ модели');
    return reply;
}

// Индикатор прогресса: статусная строка + «живое» оверлей-окно (см. setUiBusy)
let aiProgressTimer = null;
let aiElapsedTimer = null;
let aiProgressDots = 0;
let aiStartedAt = 0;

function fmtElapsed(ms) {
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// Обновление содержимого оверлея (таймер, этап, пульсирующие точки)
function renderAiOverlay() {
    const box = document.getElementById('aiOverlayStage');
    if (!box) return;
    const el = document.getElementById('aiOverlayElapsed');
    if (el && aiStartedAt) el.textContent = fmtElapsed(Date.now() - aiStartedAt);
    box.textContent = els.statusText.textContent.replace(/\s*[·]+\s*$/, '');
    const dots = document.getElementById('aiOverlayDots');
    if (dots) dots.textContent = '·'.repeat(aiProgressDots % 4) || ' ';
}

function setAiProgress(text) {
    setStatus((text || 'DeepSeek: обработка…') + ' ' + '·'.repeat(aiProgressDots % 4));
    renderAiOverlay();
}
function startAiProgress() {
    stopAiProgress();
    aiProgressDots = 0;
    aiStartedAt = Date.now();
    setAiProgress('Отправка запроса в DeepSeek');
    aiProgressTimer = setInterval(() => {
        aiProgressDots++;
        // обновляем только точки, не трогая текст, заданный извне
        const base = els.statusText.textContent.replace(/\s*[·]+\s*$/, '');
        setStatus(base + ' ' + '·'.repeat(aiProgressDots % 4));
        renderAiOverlay();
    }, 500);
    aiElapsedTimer = setInterval(renderAiOverlay, 1000);
}
function updateAiStage(text) {
    if (!state.aiBusy) return;
    setStatus(text + ' ' + '·'.repeat(aiProgressDots % 4));
    renderAiOverlay();
}
function stopAiProgress() {
    if (aiProgressTimer) { clearInterval(aiProgressTimer); aiProgressTimer = null; }
    if (aiElapsedTimer) { clearInterval(aiElapsedTimer); aiElapsedTimer = null; }
}

// Блокировка/разблокировка интерфейса на время обращения к DeepSeek.
// Окно ожидания сделано выразительным: градиентная карточка, «орбита» со
// спутником вместо обычного спиннера, живой таймер и смена этапов запроса.
function setUiBusy(busy, reasonText) {
    state.aiBusy = busy;
    document.body.classList.toggle('ai-busy', busy);
    let overlay = document.getElementById('aiOverlay');
    if (busy) {
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'aiOverlay';
            overlay.className = 'ai-overlay';
            overlay.innerHTML =
                '<div class="ai-overlay-box">' +
                '<div class="ai-orbit" aria-hidden="true">' +
                '<span class="ai-core">✨</span>' +
                '<span class="ai-satellite"></span>' +
                '<span class="ai-ring ai-ring-1"></span>' +
                '<span class="ai-ring ai-ring-2"></span>' +
                '</div>' +
                '<div class="ai-overlay-title">DeepSeek думает<span class="ai-dots"><span>.</span><span>.</span><span>.</span></span></div>' +
                '<div class="ai-overlay-text" id="aiOverlayStage">Отправка запроса…</div>' +
                '<div class="ai-overlay-timer-row">Прошло времени: <span class="ai-timer" id="aiOverlayElapsed">00:00</span><span id="aiOverlayDots"></span></div>' +
                '<div class="ai-overlay-hint">Интерфейс заблокирован до получения ответа — глубокие задания могут занять несколько минут.</div>' +
                '</div>';
            document.body.appendChild(overlay);
        }
        renderAiOverlay();
    } else if (overlay) {
        overlay.remove();
    }
    ['btnAskDeepSeek', 'btnApplyXml', 'btnCopyXml', 'btnSaveFile', 'btnPublish', 'btnLoadGist', 'btnLoadDiskFile', 'btnNewQuiz', 'btnSettings']
        .forEach(id => { const b = document.getElementById(id); if (b) b.disabled = busy; });
    if (els.xmlEditor) els.xmlEditor.readOnly = busy;
    if (els.promptText) els.promptText.readOnly = busy;
}

async function askDeepSeek(mode) {
    if (state.aiBusy) return;   // повторный клик во время обработки игнорируется
    mode = mode || currentDsMode();
    localStorage.setItem(LS.dsMode, mode);
    renderModeSelect();

    const token = getDeepseekToken();
    const xml = els.xmlEditor.value || generateXml();
    if (!xml.trim()) return showToast('XML пуст', true);

    // Промпт должен быть загружен — иначе просим загрузить из Gist
    const activePrompt = getPromptById(mode) || state.prompts[0];
    if (!activePrompt || !activePrompt.text.trim()) {
        showToast('Промпт «' + (activePrompt ? activePrompt.name : mode) + '» ещё не загружен — нажмите «↻ Gist»', true);
        reloadActivePromptFromGist();
        return;
    }

    // Без токена: копировать промпт+XML в буфер и открыть чат DeepSeek
    if (!token) {
        const payload = buildDsMessage(mode);
        try { await navigator.clipboard.writeText(payload); } catch (e) { /* не критично */ }
        showToast('Промпт и XML скопированы — вставьте их в чат DeepSeek (открыт в новом окне)');
        openExternal('https://chat.deepseek.com/');
        return;
    }

    const modeName = activePrompt.name;
    // Блокируем интерфейс и показываем прогресс на всё время обращения
    setUiBusy(true, 'DeepSeek (промпт «' + modeName + '»): обработка задания…');
    startAiProgress();
    try {
        const messages = [{ role: 'user', content: buildDsMessage(mode) }];
        let fullReply = '';
        // Модель могла не закончить задание за один ответ (нет финального блока) —
        // просим продолжить, максимум 3 дополнительных запроса.
        for (let i = 0; i < 4; i++) {
            updateAiStage(i === 0
                ? 'DeepSeek (' + modeName + '): запрос отправлен, ждём ответ…'
                : 'DeepSeek (' + modeName + '): продолжение генерации (' + i + '/3)…');
            const reply = await deepseekChat(token, messages);
            fullReply += (i > 0 ? '\n' : '') + reply;
            messages.push({ role: 'assistant', content: reply });
            if (fullReply.includes(READY_MARKER)) break;
            const hasOpen = (fullReply.match(/<quiz/g) || []).length;
            const hasClose = (fullReply.match(/<\/quiz>/g) || []).length;
            if (hasOpen > 0 && hasOpen === hasClose && extractXmlFromText(fullReply).includes('</question>')) {
                break; // XML выглядит завершённым, даже если модель забыла маркер
            }
            if (i === 3) break;
            messages.push({ role: 'user', content: 'Задание ещё не готово (нет финального XML и маркера ' + READY_MARKER + '). Продолжи и выдай ПОЛНЫЙ готовый XML целиком, без пояснений.' });
        }

        stopAiProgress();
        updateAiStage('Ответ получен — применяю к редактору…');
        const resultXml = extractXmlFromText(fullReply);
        if (!resultXml || !resultXml.includes('<quiz')) {
            // DeepSeek прислал НЕ XML: открываем редактируемое окно результата
            // с кнопками «Копировать», «Закрыть», «Отправить в DeepSeek».
            setUiBusy(false);
            showDsResultWindow(fullReply, mode);
            setStatus('DeepSeek: ответ не является XML — открыт в окне результата');
            return;
        }
        hideDsResultWindow();
        els.xmlEditor.value = resultXml;
        // Результат сразу применяем к редактору; автосохранение запишет его
        // в выбранный файл на диске (если он выбран и автосохранение включено)
        applyingXmlToEditor = true;
        let parsedOk = false;
        try {
            parsedOk = parseXmlToData(resultXml);
            if (parsedOk) {
                state.currentQuestionIndex = 0;
                renderQuestion();
            }
        } finally {
            applyingXmlToEditor = false;
        }
        markTaskChanged();
        if (parsedOk) {
            showToast('Ответ DeepSeek применён к XML и редактору');
        } else {
            showToast('Ответ получен, но XML некорректен — проверьте панель XML', true);
        }
        setStatus('DeepSeek: ответ получен и применён');
    } catch (e) {
        console.error(e);
        setStatus('DeepSeek: ошибка — ' + e.message);
        showToast('DeepSeek: ' + e.message, true);
    } finally {
        stopAiProgress();
        setUiBusy(false);
    }
}

// Кнопка «📋 Копировать» — копирует активный промпт в буфер обмена
async function copyPrompt(mode) {
    const p = getPromptById(mode) || state.prompts[0];
    try {
        await navigator.clipboard.writeText(p ? p.text : '');
        showToast('Промпт скопирован в буфер обмена');
    } catch (e) {
        showToast('Не удалось скопировать промпт', true);
    }
}

// ============================================================
// Окно результата DeepSeek (когда ответ пришёл НЕ в виде XML)
// Редактируемый текст + кнопки: Копировать / Закрыть / Отправить в DeepSeek
// ============================================================
let dsResultMode = null;   // режим (id промпта), в котором был получен не-XML ответ

function buildDsResultWindow() {
    if (document.getElementById('dsResultModal')) return; // уже есть в разметке
    const div = document.createElement('div');
    div.id = 'dsResultModal';
    div.className = 'modal-overlay';
    div.innerHTML = `
        <div class="modal modal-xl" style="display: flex; flex-direction: column;">
            <div class="modal-header">
                <h3>🤖 Ответ DeepSeek — не XML</h3>
                <button type="button" class="btn-icon" data-close title="Закрыть">✕</button>
            </div>
            <div class="modal-body" style="display:flex; flex-direction:column; gap:0.7rem;">
                <div class="ds-result-warning">⚠ Модель прислала результат не в формате XML-задания.
                    Текст можно отредактировать вручную, скопировать или отправить обратно в DeepSeek
                    (например, с уточнением, что нужен XML по шаблону).</div>
                <div id="dsResultInfo" class="prompt-editor-info"></div>
                <textarea id="dsResultArea" class="ds-result-area" spellcheck="false"></textarea>
            </div>
            <div class="ds-result-footer">
                <button type="button" class="btn" id="btnDsResultCopy">📋 Копировать</button>
                <button type="button" class="btn btn-secondary" data-close>Закрыть</button>
                <button type="button" class="btn btn-primary" id="btnDsResultSend">🤖 Отправить в DeepSeek</button>
            </div>
        </div>`;
    document.body.appendChild(div);
    els.dsResultModal = div;
    els.dsResultArea = div.querySelector('#dsResultArea');
    els.dsResultInfo = div.querySelector('#dsResultInfo');
    div.addEventListener('click', (e) => {
        if (e.target === div || (e.target.closest && e.target.closest('[data-close]'))) hideDsResultWindow();
    });
    div.querySelector('#btnDsResultCopy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(els.dsResultArea.value);
            showToast('Текст ответа скопирован в буфер обмена');
        } catch (err) { showToast('Не удалось скопировать', true); }
    });
    div.querySelector('#btnDsResultSend').addEventListener('click', () => {
        sendDsResultToDeepSeek(els.dsResultArea.value, dsResultMode || currentDsMode());
    });
}

function showDsResultWindow(text, mode) {
    buildDsResultWindow();
    dsResultMode = mode;
    els.dsResultArea.value = text;
    const p = getPromptById(mode) || state.prompts[0];
    els.dsResultInfo.textContent = 'Режим: «' + (p ? p.name : mode) + '» · длина ответа: ' + text.length + ' симв.';
    els.dsResultModal.classList.add('show');
    els.dsResultArea.focus();
}

function hideDsResultWindow() {
    if (!els.dsResultModal) return;
    els.dsResultModal.classList.remove('show');
}

// Отправка отредактированного текста окна обратно в DeepSeek.
// Ответ снова проверяется: XML -> в панель и редактор, не-XML -> остаёмся в этом окне.
async function sendDsResultToDeepSeek(userText, mode) {
    const token = getDeepseekToken();
    if (!token) { showToast('Не указан токен DeepSeek (⚙ Настройки)', true); return; }
    if (!userText.trim()) { showToast('Текст для отправки пуст', true); return; }
    const p = getPromptById(mode) || state.prompts[0];
    setUiBusy(true, 'DeepSeek (' + (p ? p.name : mode) + '): повторная отправка…');
    startAiProgress();
    try {
        const messages = [{ role: 'user', content: userText }];
        let fullReply = '';
        for (let i = 0; i < 4; i++) {
            updateAiStage(i === 0 ? 'Отправлено, ждём ответ…' : 'Продолжение генерации (' + i + '/3)…');
            const reply = await deepseekChat(token, messages);
            fullReply += (i > 0 ? '\n' : '') + reply;
            messages.push({ role: 'assistant', content: reply });
            const probe = extractXmlFromText(fullReply);
            if (fullReply.includes(READY_MARKER) || (probe && probe.includes('<quiz'))) break;
            if (i === 3) break;
            messages.push({ role: 'user', content: 'Задание ещё не готово. Выдай ПОЛНЫЙ готовый XML целиком, без пояснений.' });
        }
        stopAiProgress();
        const resultXml = extractXmlFromText(fullReply);
        if (resultXml && resultXml.includes('<quiz')) {
            hideDsResultWindow();
            els.xmlEditor.value = resultXml;
            applyingXmlToEditor = true;
            let parsedOk = false;
            try {
                parsedOk = parseXmlToData(resultXml);
                if (parsedOk) { state.currentQuestionIndex = 0; renderQuestion(); }
            } finally { applyingXmlToEditor = false; }
            markTaskChanged();
            showToast(parsedOk ? 'Ответ DeepSeek применён к XML и редактору' : 'Ответ получен, но XML некорректен — проверьте панель XML', !parsedOk);
            setStatus('DeepSeek: ответ применён');
        } else {
            showDsResultWindow(fullReply, mode);
            setStatus('DeepSeek: ответ снова не XML — осталось в окне результата');
        }
    } catch (e) {
        console.error(e);
        stopAiProgress();
        showToast('DeepSeek: ' + e.message, true);
        setStatus('DeepSeek: ошибка — ' + e.message);
    } finally {
        stopAiProgress();
        setUiBusy(false);
    }
}

// ============================================================
// UI-хелперы
// ============================================================
function showToast(msg, isErr = false) {
    const t = els.toast;
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' error' : '');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function setStatus(text) {
    els.statusText.textContent = text;
}

function showLoadModal() { els.loadModal.classList.add('show'); els.loadGistId.focus(); }
function hideLoadModal() { els.loadModal.classList.remove('show'); }
function showSettingsModal() { els.settingsModal.classList.add('show'); }
function hideSettingsModal() { els.settingsModal.classList.remove('show'); saveSettings(); }

// ============================================================
// Resizer для XML-панели (тянем за правую границу — меняем ширину)
// ============================================================
function initResizer() {
    const resizer = els.resizer;
    const panel = els.xmlPanel;
    let startX = 0, startW = 0;

    const doDrag = (e) => {
        const x = e.clientX ?? (e.touches && e.touches[0].clientX) ?? x;
        const w = Math.max(220, Math.min(window.innerWidth * 0.7, startW + (x - startX)));
        panel.style.width = w + 'px';
    };
    const stopDrag = () => {
        document.removeEventListener('mousemove', doDrag);
        document.removeEventListener('mouseup', stopDrag);
        document.removeEventListener('touchmove', doDrag);
        document.removeEventListener('touchend', stopDrag);
        resizer.classList.remove('active');
    };
    const start = (e) => {
        startX = e.clientX ?? (e.touches && e.touches[0].clientX) ?? 0;
        startW = panel.getBoundingClientRect().width;
        resizer.classList.add('active');
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchmove', doDrag);
        document.addEventListener('touchend', stopDrag);
        e.preventDefault();
    };
    resizer.addEventListener('mousedown', start);
    resizer.addEventListener('touchstart', start, { passive: false });
}
