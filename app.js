// Moodle XML Тестирование — логика приложения (извлечена из index.html при рефакторинге)
'use strict';
// =============================================================
// Константы
// =============================================================
const CRUSH_MAX_ERRORS = 3; // максимум ошибок за одну сессию в CrushMode
const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К'];
const YANDEX_API_PREFIX = 'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=';
const STORAGE_KEY_STUDENT = 'quizStudent';
const SCORE_RING_LENGTH = 440;      // длина окружности индикатора результата (2·π·70)
const GRADE_THRESHOLDS = [          // процент правильных ответов -> оценка по 5-балльной шкале
    { min: 85, grade: 5 },
    { min: 70, grade: 4 },
    { min: 50, grade: 3 },
];

// Состояния сессии CrushMode
const CRUSH_STATE = { ANSWERING: 'answering', CORRECT: 'correct', RESTART: 'restart' };

// Демо-тест (вставляется в редактор/загружается по кнопке «Демо-тест»)
const DEMO_QUIZ_XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
    <topicName>Демо: формулы и таблицы</topicName>
    <question type="multichoice">
        <name><text>Пример с формулой 1</text></name>
        <questiontext format="html">
            <text><![CDATA[<p>Выберите правильную формулу для расчёта коэффициента:</p><p>\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)</p>]]></text>
        </questiontext>
        <answer fraction="100"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{сэ}}}{\\text{АД}_{\\text{с}}}\\)]]></text></answer>
        <answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\frac{\\text{АД}_{\\text{с}}}{\\text{АД}_{\\text{сэ}}}\\)]]></text></answer>
        <answer fraction="0"><text><![CDATA[\\(\\alpha_{\\text{н}} = \\text{АД}_{\\text{сэ}} + \\text{АД}_{\\text{с}}\\)]]></text></answer>
    </question>
    <question type="multichoice">
        <name><text>Пример с формулой 2</text></name>
        <questiontext format="html">
            <text><![CDATA[<p>Чему равно значение \\(E = mc^2\\) при m = 2, c = 3?</p>]]></text>
        </questiontext>
        <answer fraction="0"><text>6</text></answer>
        <answer fraction="100"><text>18</text></answer>
        <answer fraction="0"><text>12</text></answer>
    </question>
    <question type="multichoice">
        <name><text>Пример с таблицей</text></name>
        <questiontext format="html">
            <text><![CDATA[<table border="1"><tr><th>Ячейка</th><th>Показатель</th><th>Обозначение</th><th>Значение</th><th>Единицы измерения</th></tr><tr><td>A1</td><td>?</td><td>Q</td><td>—</td><td>—</td></tr></table><p>Какой показатель должен находиться в ячейке A1?</p>]]></text>
        </questiontext>
        <answer fraction="100"><text><![CDATA[<p>Объёмный расход</p>]]></text></answer>
        <answer fraction="0"><text><![CDATA[<p>Давление</p>]]></text></answer>
        <answer fraction="0"><text><![CDATA[<p>Температура</p>]]></text></answer>
    </question>
</quiz>`;

// =============================================================
// Состояние приложения
// =============================================================
let questions = [];           // распарсенные вопросы [{name, text, type, single, answers, clozeBlanks, isCorrect, _checked}]
let currentQuestionIndex = 0;
let userAnswers = [];         // индекс(ы) выбранного варианта (null — нет ответа; массив — множественный выбор)
let userTextAnswers = [];     // введённый текст для shortanswer / numerical
let userClozeAnswers = [];    // значения пропусков cloze: [{blankIndex: value}, ...] по вопросам
let startTime = null;         // момент старта теста (Date.now())
let timerInterval = null;
let timeSpent = 0;            // секунды с момента старта теста
let studentName = '';
let pendingStartAfterName = false; // автозагрузка ждёт подтверждения ФИО
let qrScannerActive = false;
let videoStream = null;
let checkMode = false;        // CheckMode=true   — на каждом вопросе кнопка «Проверить ответ» (в любом режиме)
let randomMode = false;       // RandomMode=true  — случайный порядок вопросов
let crushMode = false;        // CrushMode=true   — проверка при переходе, 3 ошибки = старт заново
let headerShow = false;       // HeaderShow=true  — показывать заголовок вопроса из <name>
let crushState = CRUSH_STATE.ANSWERING;
let crushErrors = 0;          // сколько ошибок сделано в текущей сессии (CrushMode)
let checkedQuestions = [];    // какие вопросы уже проверены (CheckMode)
let feedbackStore = [];       // {ok, correctTexts} для восстановления фидбэка при навигации (CheckMode)
let testTopicName = '';       // содержимое <topicName> из XML (если есть)

// ===== Элементы DOM =====
const uploadSection = document.getElementById('uploadSection');
const urlInput = document.getElementById('urlInput');
const loadUrlBtn = document.getElementById('loadUrlBtn');
const qrCodeBtn = document.getElementById('qrCodeBtn');
const yandexBtn = document.getElementById('yandexBtn');
const demoBtn = document.getElementById('demoBtn');
const uploadStatus = document.getElementById('uploadStatus');
const testSection = document.getElementById('testSection');
const timerElement = document.getElementById('timer');
const currentQuestionElement = document.getElementById('currentQuestion');
const totalQuestionsElement = document.getElementById('totalQuestions');
const progressFill = document.getElementById('progressFill');
const questionsContainer = document.getElementById('questionsContainer');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const finishBtn = document.getElementById('finishBtn');
const resultsSection = document.getElementById('resultsSection');
const resultsSummary = document.getElementById('resultsSummary');
const resultAvatar = document.getElementById('resultAvatar');
const resultStudentName = document.getElementById('resultStudentName');
const scoreRing = document.getElementById('scoreRing');
const scoreElement = document.getElementById('score');
const gradePill = document.getElementById('gradePill');
const correctAnswersElement = document.getElementById('correctAnswers');
const totalAnswersElement = document.getElementById('totalAnswers');
const timeSpentElement = document.getElementById('timeSpent');
const restartBtn = document.getElementById('restartBtn');
const changeNameBtn = document.getElementById('changeNameBtn');
const detailedResults = document.getElementById('detailedResults');
const studentChip = document.getElementById('studentChip');
const chipAvatar = document.getElementById('chipAvatar');
const chipName = document.getElementById('chipName');
const welcomeOverlay = document.getElementById('welcomeOverlay');
const lastNameInput = document.getElementById('lastNameInput');
const firstNameInput = document.getElementById('firstNameInput');
const middleNameInput = document.getElementById('middleNameInput');
const nameError = document.getElementById('nameError');
const confirmNameBtn = document.getElementById('confirmNameBtn');
const qrModal = document.getElementById('qrModal');
const qrVideo = document.getElementById('qrVideo');
const qrStatus = document.getElementById('qrStatus');
const closeQrBtn = document.getElementById('closeQrBtn');
const checkBadge = document.getElementById('checkBadge');
const crushBadge = document.getElementById('crushBadge');
const headerBadge = document.getElementById('headerBadge');
const crushAttemptsPill = document.getElementById('crushAttemptsPill');
const checkAnswerBtn = document.getElementById('checkAnswerBtn'); // «Проверить ответ» — единая кнопка проверки (CheckMode и/или CrushMode)


// ===== Вспомогательные функции =====
function isAnyOverlayOpen() {
    return !welcomeOverlay.classList.contains('hidden') ||
           !qrModal.classList.contains('hidden');
}

function updateScrollLock() {
    document.body.style.overflow = isAnyOverlayOpen() ? 'hidden' : 'auto';
}

function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = n => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function friendlyError(error) {
    if (error instanceof TypeError && /fetch/i.test(error.message)) {
        return new Error('Не удалось загрузить файл. Проверьте ссылку, доступность файла и разрешения CORS на сервере.');
    }
    return error;
}

// Перемешивание массива на месте (Фишер—Йетс) — используется для вопросов и вариантов
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function isValidUrl(string) {
    try { new URL(string); return true; } catch (_) { return false; }
}

function showUploadStatus(message, type) {
    uploadStatus.textContent = message;
    uploadStatus.className = 'status-message';
    if (type) uploadStatus.classList.add(type);
    uploadStatus.classList.remove('hidden');
}

function applyMathJax() {
    if (window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise().catch(err => console.log('Ошибка MathJax: ' + err.message));
    }
}

// ===== Определение типа контента =====
// Есть ли в строке HTML-теги
function containsHtml(str) {
    return /<\/?[a-z][^>]*>/i.test(str || '');
}

// Есть ли в строке LaTeX-разделители
function containsMath(str) {
    const t = str || '';
    return t.includes('\\(') || t.includes('\\[');
}

// Однократное декодирование HTML-сущностей (&lt; &gt; &amp; ...)
function decodeEntities(str) {
    const el = document.createElement('textarea');
    el.innerHTML = str;
    return el.value;
}

// Защита угловых скобок внутри LaTeX (\( a < b \) не должна превратиться в тег)
function protectMathAngles(html) {
    return html.replace(/(\\[\(\[][\s\S]*?\\[\)\]])/g, seg =>
        seg.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    );
}

// ===== Логика ФИО =====
function getFullName() {
    return [lastNameInput.value.trim(), firstNameInput.value.trim(), middleNameInput.value.trim()]
        .filter(Boolean).join(' ');
}

function updateStudentUI() {
    const parts = studentName.split(' ').filter(Boolean);
    const initials = ((parts[0] || '')[0] || '') + ((parts[1] || '')[0] || '');
    chipAvatar.textContent = initials || '—';
    chipName.textContent = parts.length > 1
        ? `${parts[0]} ${parts[1][0]}.` : studentName;
    studentChip.classList.remove('hidden');
    resultStudentName.textContent = studentName;
    resultAvatar.textContent = initials || '—';
}

function confirmName() {
    const l = lastNameInput.value.trim();
    const f = firstNameInput.value.trim();
    nameError.classList.add('hidden');
    if (l.length < 2 || f.length < 2) {
        nameError.textContent = 'Пожалуйста, укажите фамилию и имя (минимум 2 символа)';
        nameError.classList.remove('hidden');
        return;
    }
    studentName = getFullName();
    try {
        localStorage.setItem(STORAGE_KEY_STUDENT, JSON.stringify({
            l, f, m: middleNameInput.value.trim()
        }));
    } catch (e) { console.warn('localStorage недоступен', e); }
    updateStudentUI();
    welcomeOverlay.classList.add('hidden');
    updateScrollLock();

    if (pendingStartAfterName && questions.length > 0) {
        pendingStartAfterName = false;
        startTest();
    } else if (!uploadSection.classList.contains('hidden')) {
        urlInput.focus();
    }
}

function openNameOverlay() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_STUDENT) || 'null');
        if (saved) {
            lastNameInput.value = saved.l || '';
            firstNameInput.value = saved.f || '';
            middleNameInput.value = saved.m || '';
        }
    } catch (e) {}
    pendingStartAfterName = false;
    nameError.classList.add('hidden');
    welcomeOverlay.classList.remove('hidden');
    updateScrollLock();
}

// ===== Чтение параметров из адресной строки =====
function getTestUrlFromLocation() {
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('name') || params.get('test') || params.get('url') || '';
    } catch (e) {
        console.error('Ошибка парсинга URL параметров:', e);
        return '';
    }
}

// Универсальное чтение флага режима (CheckMode, CrushMode, HeaderShow и т.п.)
function getUrlFlag(name) {
    try {
        const params = new URLSearchParams(window.location.search);
        for (const [key, value] of params.entries()) {
            if (key.toLowerCase() === name.toLowerCase()) {
                // поддерживаем: ?CrushMode, ?CrushMode=true / 1 / yes
                return value === '' || ['true', '1', 'yes'].includes(value.toLowerCase());
            }
        }
    } catch (e) {
        console.error('Ошибка парсинга URL параметров:', e);
    }
    return false;
}

// ===== Загрузка и парсинг теста =====
async function fetchAndParseTest(url) {
    let target = url;

    if (url.includes('yadi.sk') || url.includes('disk.yandex')) {
        const resp = await fetch(YANDEX_API_PREFIX + encodeURIComponent(url));
        if (!resp.ok) {
            if (resp.status === 403) throw new Error('403: Доступ запрещён. Проверьте права доступа к файлу');
            if (resp.status === 404) throw new Error('404: Файл не найден. Проверьте ссылку и права доступа');
            throw new Error(`Ошибка HTTP: ${resp.status}`);
        }
        const data = await resp.json();
        if (!data.href) throw new Error('Не удалось получить ссылку для скачивания с Яндекс.Диска');
        target = data.href;
    }

    const response = await fetch(target);
    if (!response.ok) throw new Error(`Ошибка HTTP: ${response.status}`);
    const xmlContent = await response.text();
    parseMoodleXML(xmlContent);

    if (questions.length === 0) {
        throw new Error('Не удалось найти вопросы в XML файле');
    }
}

async function autoLoadTest(url) {
    try {
        await fetchAndParseTest(url);
        console.log(`Автоматически загружен тест с ${questions.length} вопросами`);
        uploadSection.classList.add('hidden');
        if (studentName) {
            startTest();
        } else {
            pendingStartAfterName = true;
        }
    } catch (error) {
        const err = friendlyError(error);
        console.error('Ошибка автозагрузки теста:', err);
        uploadSection.classList.remove('hidden');
        urlInput.value = url;
        showUploadStatus(`Ошибка загрузки: ${err.message}`, 'error');
    }
}

// ===== Демо-тест =====
window.loadExampleTest = function () {
    parseMoodleXML(DEMO_QUIZ_XML);
    if (questions.length > 0) {
        beginLoadedTest(`Загружен демо-тест с ${questions.length} вопросами`);
    }
};

// Кнопки секции загрузки: блокировка на время загрузки XML-файла
const UPLOAD_BUTTONS = [loadUrlBtn, qrCodeBtn, yandexBtn, demoBtn];
function setUploadButtonsBusy(busy) {
    UPLOAD_BUTTONS.forEach(btn => { btn.disabled = busy; });
    loadUrlBtn.textContent = busy ? 'Загрузка...' : '🔗 Загрузить';
}

// Успешная загрузка теста: сообщение и автозапуск через короткую паузу
function beginLoadedTest(message) {
    showUploadStatus(message, 'success');
    setTimeout(() => { uploadStatus.classList.add('hidden'); startTest(); }, 1200);
}

// ===== Ручная загрузка по URL =====
async function handleUrlLoad() {
    const url = urlInput.value.trim();
    if (!url) { showUploadStatus('Пожалуйста, введите URL XML файла', 'error'); return; }
    if (!isValidUrl(url)) { showUploadStatus('Пожалуйста, введите корректный URL', 'error'); return; }
    if (!url.toLowerCase().includes('.xml')) {
        if (!confirm('URL не заканчивается на .xml. Продолжить загрузку?')) return;
    }
    try {
        showUploadStatus('Загрузка теста...', 'loading');
        setUploadButtonsBusy(true);

        await fetchAndParseTest(url);

        beginLoadedTest(`Успешно загружен тест с ${questions.length} вопросами`);
    } catch (error) {
        const err = friendlyError(error);
        console.error('Ошибка загрузки теста:', err);
        showUploadStatus(`Ошибка загрузки: ${err.message}`, 'error');
    } finally {
        setUploadButtonsBusy(false);
    }
}

function handleYandexLoad() {
    const link = prompt('Вставьте публичную ссылку на XML-файл на Яндекс.Диске:', urlInput.value);
    if (!link) return;
    urlInput.value = link.trim();
    handleUrlLoad();
}

// ===== QR-сканер =====
async function startQRScanner() {
    if (typeof jsQR !== 'function') {
        showUploadStatus('Библиотека сканирования не загрузилась. Введите ссылку вручную.', 'error');
        return;
    }
    qrModal.classList.remove('hidden');
    updateScrollLock();
    qrScannerActive = true;
    qrStatus.textContent = 'Запуск камеры...';
    qrStatus.style.color = '';

    try {
        videoStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: false
        });
        qrVideo.srcObject = videoStream;
        qrVideo.setAttribute('playsinline', true);
        await qrVideo.play();
        qrStatus.textContent = 'Наведите камеру на QR-код';
        qrStatus.style.color = '';
        requestAnimationFrame(scanQRCode);
    } catch (error) {
        console.error('Ошибка доступа к камере:', error);
        qrStatus.textContent = 'Ошибка доступа к камере. Разрешите доступ в настройках браузера или введите ссылку вручную в поле выше.';
        qrStatus.style.color = 'red';
    }
}

function scanQRCode() {
    if (!qrScannerActive) return;
    if (qrVideo.readyState === qrVideo.HAVE_ENOUGH_DATA) {
        const canvas = document.createElement('canvas');
        canvas.width = qrVideo.videoWidth;
        canvas.height = qrVideo.videoHeight;
        const context = canvas.getContext('2d');
        context.drawImage(qrVideo, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        });
        if (code && code.data) {
            qrStatus.textContent = 'QR-код распознан!';
            qrStatus.style.color = 'green';
            urlInput.value = code.data;
            setTimeout(() => {
                stopQRScanner();
                showUploadStatus('Ссылка из QR-кода вставлена', 'success');
                setTimeout(() => uploadStatus.classList.add('hidden'), 2500);
            }, 800);
            return;
        }
    }
    if (qrScannerActive) requestAnimationFrame(scanQRCode);
}

function stopQRScanner() {
    qrScannerActive = false;
    qrModal.classList.add('hidden');
    updateScrollLock();
    qrStatus.textContent = 'Наведите камеру на QR-код';
    qrStatus.style.color = '';
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    if (qrVideo.srcObject) qrVideo.srcObject = null;
}

// ===== Парсинг Moodle XML =====
function parseMoodleXML(xmlContent) {
    questions = [];
    testTopicName = '';
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');

    // Название темы: тег <topicName> (берём первое вхождение в файле, если оно есть)
    const topicNodes = xmlDoc.getElementsByTagName('topicName');
    if (topicNodes.length > 0) {
        const tn = (topicNodes[0].textContent || '').trim();
        if (tn) testTopicName = tn;
    }

    const questionNodes = xmlDoc.getElementsByTagName('question');

    for (let node of questionNodes) {
        const type = node.getAttribute('type') || 'multichoice';
        if (type === 'category') continue;   // служебный контейнер Moodle

        // Название вопроса из тега <name> (для режима HeaderShow)
        let questionName = '';
        const nameNodes = node.getElementsByTagName('name');
        if (nameNodes.length > 0) {
            const nameTextNodes = nameNodes[0].getElementsByTagName('text');
            if (nameTextNodes.length > 0) questionName = nameTextNodes[0].textContent.trim();
        }

        // Текст вопроса
        let questionText = '';
        const questionTextNodes = node.getElementsByTagName('questiontext');
        if (questionTextNodes.length > 0) {
            const textNodes = questionTextNodes[0].getElementsByTagName('text');
            if (textNodes.length > 0) questionText = textNodes[0].textContent.trim();
        }

        // Description — вопрос-описание без ответа: текст в <questiontext>,
        // выводится как обычный текст, проверке не подлежит
        if (type === 'description') {
            // (текст уже взят из <questiontext>; отдельного тега <description> в Moodle нет)
            if (!questionText) continue;
            questions.push({
                name: questionName, text: processHtmlContent(questionText),
                type: 'description', single: true, answers: [], clozeBlanks: null,
                isCorrect: false, _checked: false,
            });
            continue;
        }

        if (!questionText) continue;
        questionText = processHtmlContent(questionText);

        // ---- Cloze: пропуски {...:Тип:ответ%вес%альт~неверный...} внутри текста ----
        if (type === 'cloze') {
            const blanks = parseClozeBlanks(questionText);
            if (!blanks.length) continue;
            questions.push({
                name: questionName, text: questionText,
                type: 'cloze', single: true, answers: [], clozeBlanks: blanks,
                isCorrect: false, _checked: false,
            });
            continue;
        }

        // ---- True/False: фиксированные варианты «Верно» / «Неверно» ----
        if (type === 'truefalse') {
            const answers = [{ text: 'Верно', isCorrect: false }, { text: 'Неверно', isCorrect: false }];
            const answerNodes = node.getElementsByTagName('answer');
            for (let answerNode of answerNodes) {
                const t = (answerNode.getElementsByTagName('text')[0]?.textContent || '').trim().toLowerCase();
                const idx = (t === 'true' || t === 'верно' || t === 'да' || t === 'истина') ? 0 : 1;
                answers[idx].isCorrect = parseFloat(answerNode.getAttribute('fraction') || 0) > 0;
            }
            questions.push({
                name: questionName, text: questionText,
                type: 'truefalse', single: true, answers, clozeBlanks: null,
                isCorrect: false, _checked: false,
            });
            continue;
        }

        // ---- Одиночный / множественный выбор (single=true/false) ----
        const singleEl = node.getElementsByTagName('single')[0];
        const single = !singleEl || (singleEl.textContent || 'true').trim() !== 'false';

        // Варианты ответа
        const answers = [];
        const answerNodes = node.getElementsByTagName('answer');
        for (let answerNode of answerNodes) {
            let answerText = '';
            const textNodes = answerNode.getElementsByTagName('text');
            if (textNodes.length > 0) answerText = textNodes[0].textContent.trim();
            if (!answerText) continue;
            answerText = processHtmlContent(answerText);
            const fraction = parseFloat(answerNode.getAttribute('fraction') || 0);
            const ans = { text: answerText, isCorrect: fraction > 0 };
            // Shortanswer / numerical: допуск и эталонные ответы
            const tolEl = answerNode.getElementsByTagName('tolerance')[0];
            if (tolEl) ans.tolerance = parseFloat(tolEl.textContent) || 0;
            answers.push(ans);
        }

        if (answers.length === 0) continue;

        // shortanswer / numerical: все непустые варианты — правильные ответы
        // (эталонные формулировки; проверяются вводом с клавиатуры)
        let qType = type;
        if (type === 'shortanswer' || type === 'numerical') {
            answers.forEach(a => { a.isCorrect = true; });
        } else if (type !== 'multichoice') {
            // неизвестный тип с вариантами трактуем как multichoice
            qType = 'multichoice';
        }

        questions.push({
            name: questionName, text: questionText,
            type: qType, single, answers, clozeBlanks: null,
            isCorrect: false, _checked: false,
        });
    }
    console.log(`Найдено ${questions.length} вопросов` + (testTopicName ? `, тема: ${testTopicName}` : ''));
}

// ===== Cloze: разбор пропусков {...:Тип:содержимое} =====
// MCMS      — выпадающий список: "верный%100%alt~неверный%0"
// T/F/MW    — текстовый пропуск: "ответ|альтернатива:фидбек"
// NUMERICAL — числовой пропуск:  "число&допуск|число2:фидбек"
const CLOZE_BLANK_RE = /\{\.\.\.:([^{}]+)\}/g;
const CLOZE_TYPES = ['MCMS', 'T', 'F', 'MW', 'NUMERICAL'];

function parseClozeBlanks(text) {
    const blanks = [];
    let m;
    CLOZE_BLANK_RE.lastIndex = 0;
    while ((m = CLOZE_BLANK_RE.exec(text)) !== null) {
        const segs = m[1].split(':');
        let type = (segs[0] || '').trim().toUpperCase();
        if (!CLOZE_TYPES.includes(type)) type = 'MCMS';
        const rest = segs.slice(1).join(':');
        let answerPart = rest, feedback = '';
        const fc = answerPart.lastIndexOf(':');
        if (fc >= 0) { feedback = answerPart.slice(fc + 1); answerPart = answerPart.slice(0, fc); }

        const answers = [];
        if (type === 'MCMS') {
            answerPart.split('~').forEach((group, gi) => {
                group.split('|').forEach(chunk => {
                    const mm = chunk.match(/^(.*?)%(\d+)%(.*)$/s);
                    const t = mm ? mm[1].trim() : chunk.trim();
                    if (t) answers.push({ text: t, correct: gi === 0 });
                });
            });
        } else if (type === 'NUMERICAL') {
            answerPart.split('|').forEach(a => {
                const amp = a.indexOf('&');
                const t = (amp >= 0 ? a.slice(0, amp) : a).trim();
                if (t) answers.push({ text: t, tolerance: amp >= 0 ? (parseFloat(a.slice(amp + 1)) || 0) : 0, correct: true });
            });
        } else {
            answerPart.split('|').forEach(a => {
                const t = a.trim();
                if (t) answers.push({ text: t, correct: true });
            });
        }
        if (answers.some(a => a.correct)) blanks.push({ type, answers, feedback });
    }
    return blanks;
}

// Проверка строкового ответа: совпадение с одним из эталонов (без учёта регистра,
// лишних пробелов и ё/е), для NUMERICAL — число с допуском
function matchShortAnswer(userStr, candidates) {
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е');
    const u = norm(userStr);
    if (!u) return false;
    return candidates.some(c => {
        if (c.tolerance !== undefined && c.tolerance !== null) {
            const uv = parseFloat(String(userStr).replace(',', '.'));
            const cv = parseFloat(String(c.text).replace(',', '.'));
            return Number.isFinite(uv) && Number.isFinite(cv) && Math.abs(uv - cv) <= (c.tolerance || 0);
        }
        return norm(c.text) === u;
    });
}

// Обработка HTML-содержимого из CDATA:
// убираем CDATA-обёртки, декодируем двойное экранирование,
// чистим параграфы и нормализуем <br>
function processHtmlContent(content) {
    let c = content || '';
    c = c.replace(/<!\[CDATA\[|\]\]>/g, '');

    // Если есть HTML-сущности — декодируем их один раз.
    // Это разворачивает двойное экранирование (&lt;table&gt; -> <table>)
    // и корректно показывает спецсимволы (&nbsp; -> пробел и т.п.)
    if (/&(lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/i.test(c)) {
        const decoded = decodeEntities(c);
        if (containsHtml(decoded) || !containsHtml(c)) {
            c = decoded;
        }
    }

    c = c.replace(/<\/?p(\s[^>]*)?>/gi, '');  // <p> и <p class="...">
    c = c.replace(/<br\s*\/?>/gi, '<br>');
    return c.trim();
}

// Универсальный рендерер текста вопроса/ответа:
// HTML (таблицы, картинки, списки) и/или LaTeX — через innerHTML,
// простой текст — через textContent (защита от случайной разметки)
function renderTextWithMath(text) {
    const container = document.createElement('div');
    container.className = 'formula-container';
    const t = text || '';

    if (containsHtml(t) || containsMath(t)) {
        container.innerHTML = containsMath(t) ? protectMathAngles(t) : t;
    } else {
        container.textContent = t;
    }
    return container;
}

// ===== Перемешивание вопросов =====
// Используется только в режиме RandomMode — там порядок вопросов случайный.
// В остальных режимах вопросы идут последовательно от первого
function shuffleQuestions() {
    shuffleArray(questions);
}

// ===== Перемешивание вариантов ответов =====
// Выполняется во всех режимах — варианты всегда выводятся случайным образом
// (фиксированные пары truefalse не перемешиваем, чтобы «Верно» всегда шло первым;
//  пропуски cloze идут в порядке текста вопроса)
function shuffleAnswers() {
    questions.forEach(q => {
        if (q.type === 'truefalse' || q.type === 'cloze') return;
        shuffleArray(q.answers);
    });
}

// Есть ли у студента ответ на данный вопрос (для любого типа)
function hasAnswer(idx) {
    const q = questions[idx];
    if (!q) return false;
    switch (q.type) {
        case 'shortanswer':
        case 'numerical':
            return !!(userTextAnswers[idx] && userTextAnswers[idx].trim());
        case 'cloze':
            // «Отвечен», если заполнен хотя бы один пропуск (незаполненные
            // считаются неверными — как в Moodle); иначе ответа нет
            return !!q.clozeBlanks &&
                q.clozeBlanks.some((b, bi) => getClozeValue(idx, bi) !== null);
        case 'multichoice':
            if (!q.single) return Array.isArray(userAnswers[idx]) && userAnswers[idx].length > 0;
            return userAnswers[idx] !== null && userAnswers[idx] !== undefined;
        case 'description':   // вопрос-инструкция: «отвечен» автоматически
            return true;
        default: // truefalse
            return userAnswers[idx] !== null && userAnswers[idx] !== undefined;
    }
}

// Аккуратное чтение значения поля ввода cloze из модели (значения сохраняются
// в userClozeAnswers при каждом изменении, поэтому переживает перерисовки)
function getClozeValue(idx, bi) {
    const m = userClozeAnswers[idx];
    if (!m) return null;
    const v = m[bi];
    return (v === undefined || v === null || v === '') ? null : v;
}

// ===== Оценка ответа на вопрос (без сайд-эффектов для подсветки) =====
function evaluateQuestion(q, idx) {
    switch (q.type) {
        case 'description':
            return { answered: true, correct: true, skipped: true };
        case 'shortanswer':
        case 'numerical': {
            const t = (userTextAnswers[idx] || '').trim();
            if (!t) return { answered: false, correct: false };
            return { answered: true, correct: matchShortAnswer(t, q.answers) };
        }
        case 'cloze': {
            let allCorrect = true;
            const vals = [];
            q.clozeBlanks.forEach((b, bi) => {
                const v = getClozeValue(idx, bi);   // null — пропуск не заполнен
                vals.push(v);
                const ok = v !== null && (b.type === 'MCMS'
                    ? b.answers.some(a => a.correct && a.text === v)
                    : matchShortAnswer(v, b.answers));
                if (!ok) allCorrect = false;       // незаполненный пропуск = ошибка
            });
            return { answered: hasAnswer(idx), correct: allCorrect, clozeValues: vals };
        }
        default: { // multichoice / truefalse
            const sel = userAnswers[idx];
            if (!q.single && Array.isArray(sel)) {
                if (!sel.length) return { answered: false, correct: false };
                const correctSet = q.answers.map((a, i) => a.isCorrect ? i : -1).filter(i => i >= 0).sort((a, b) => a - b);
                const selSorted = [...sel].sort((a, b) => a - b);
                const eq = correctSet.length === selSorted.length &&
                    correctSet.every((v, k) => v === selSorted[k]);
                return { answered: true, correct: eq };
            }
            if (sel === null || sel === undefined) return { answered: false, correct: false };
            return { answered: true, correct: !!q.answers[sel].isCorrect };
        }
    }
}

// ===== Запуск теста =====
function startTest() {
    if (questions.length === 0) return;

    // Сброс состояния
    currentQuestionIndex = 0;
    userAnswers = new Array(questions.length).fill(null);
    userTextAnswers = new Array(questions.length).fill('');
    userClozeAnswers = new Array(questions.length).fill(null);
    checkedQuestions = new Array(questions.length).fill(false);
    feedbackStore = new Array(questions.length).fill(null);
    questions.forEach(q => {
        q.isCorrect = false; q._checked = false;
        if (q.type === 'multichoice' && !q.single) q.answers.forEach(a => { a.selected = false; });
    });
    crushErrors = 0;
    crushState = CRUSH_STATE.ANSWERING;
    timeSpent = 0;
    startTime = Date.now();

    // Порядок вопросов: в CrushMode — строго по порядку расположения в тесте;
    // в RandomMode (без CrushMode) — случайный; иначе последовательно от первого
    if (randomMode && !crushMode) shuffleQuestions();

    // Варианты ответов перемешиваются во всех режимах
    shuffleAnswers();

    // Таймер
    if (timerInterval) clearInterval(timerInterval);
    timerElement.textContent = '00:00:00';
    timerInterval = setInterval(() => {
        timeSpent++;
        timerElement.textContent = formatTime(timeSpent);
    }, 1000);

    // Настройка интерфейса
    uploadSection.classList.add('hidden');
    resultsSection.classList.add('hidden');
    testSection.classList.remove('hidden');

    totalQuestionsElement.textContent = questions.length;
    updateCrushAttemptsPill();
    updateNavigation();

    renderQuestion();
    updateScrollLock();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Панель управления навигацией =====
// Единая логика без дублирующихся кнопок:
//   «Назад»            — только если возврат разрешён (не в CrushMode);
//   «Проверить ответ»  — одна кнопка, показывается в CheckMode и/или CrushMode;
//   «Вперёд →»         — ЕДИНСТВЕННАЯ кнопка движения вперёд. В обычном режиме /
//                        CheckMode активна всегда (кроме последнего вопроса);
//                        в CrushMode скрыта до верного ответа, после верного
//                        ответа появляется с подписью «Дальше →»;
//   «Завершить тест»   — на последнем вопросе (в CrushMode — только после верного
//                        ответа). Отдельной кнопки «Дальше» больше нет.
function updateNavigation() {
    const idx = currentQuestionIndex;
    const last = idx === questions.length - 1;

    // Возврат назад: в CrushMode двигаться можно только вперёд (после верного ответа)
    prevBtn.classList.toggle('hidden', crushMode);
    prevBtn.disabled = idx === 0;

    // Единая кнопка проверки (CheckMode и/или CrushMode)
    checkAnswerBtn.classList.toggle('hidden', !(checkMode || crushMode));
    if (checkMode || crushMode) {
        if (crushMode) {
            // в CrushMode проверка активна до получения верного ответа
            checkAnswerBtn.disabled = crushState !== CRUSH_STATE.ANSWERING;
        } else {
            // в CheckMode после проверки вопрос зафиксирован
            checkAnswerBtn.disabled = checkedQuestions[idx] === true;
        }
    }

    // Описание без ответа — проверять нечего; «Дальше →» открываем сразу
    // (handleNext/goToQuestion пропускают описание отдельно, состояние CORRECT
    //  здесь не выставляется, чтобы оно не «протекло» на следующий вопрос)
    if (q0typeIsDescription(idx)) {
        checkAnswerBtn.classList.add('hidden');
    }

    if (crushMode) {
        const correct = crushState === CRUSH_STATE.CORRECT;
        // Движение вперёд — только через единственную кнопку nextBtn/finishBtn
        nextBtn.classList.toggle('hidden', !correct || last);
        nextBtn.textContent = 'Дальше →';
        finishBtn.classList.toggle('hidden', !(correct && last));
    } else {
        nextBtn.textContent = 'Вперёд →';
        nextBtn.classList.toggle('hidden', last);
        finishBtn.classList.toggle('hidden', !last);
        // Описание без ответа — сразу доступно движение вперёд
        if (q0typeIsDescription(idx)) {
            checkAnswerBtn.classList.add('hidden');
        }
    }
}

function updateCrushAttemptsPill() {
    if (!crushMode) return;
    crushAttemptsPill.textContent = `🎯 Осталось попыток: ${Math.max(0, CRUSH_MAX_ERRORS - crushErrors)}`;
}

// ===== Отрисовка текущего вопроса =====
function renderQuestion() {
    const idx = currentQuestionIndex;
    const q = questions[idx];
    questionsContainer.innerHTML = '';

    // CrushMode: состояние CORRECT легитимно «переживает» перерисовку при переходе
    // «Дальше →» и сбрасывается только при первой проверке нового вопроса
    // (handleCrushCheck) либо при возврате из restartCrushSession.

    const card = document.createElement('div');
    card.className = 'question';

    // Заголовок вопроса (HeaderShow=true)
    if (headerShow && q.name) {
        const headerEl = document.createElement('div');
        headerEl.className = 'question-header';
        headerEl.appendChild(renderTextWithMath(q.name));
        card.appendChild(headerEl);
    }

    // Описание без ответа — просто выводим текст, навигация открыта
    if (q.type === 'description') {
        const textEl = document.createElement('div');
        textEl.className = 'question-text';
        textEl.appendChild(renderTextWithMath(q.text));
        card.appendChild(textEl);
        questionsContainer.appendChild(card);
        updateCounters();
        applyMathJax();
        return;
    }

    // Текст вопроса (HTML + LaTeX). Для cloze заменяется на интерактивный вариант
    const textEl = document.createElement('div');
    textEl.className = 'question-text';
    if (q.type === 'cloze') buildClozeQuestionHtml(q, textEl);
    else textEl.appendChild(renderTextWithMath(q.text));
    card.appendChild(textEl);

    const locked = (checkMode && !crushMode && checkedQuestions[idx]) ||
                   (crushMode && crushState === CRUSH_STATE.CORRECT);

    // Поле ввода для shortanswer / numerical
    if (q.type === 'shortanswer' || q.type === 'numerical') {
        card.appendChild(buildTextInputAnswer(q, idx, locked));
    }

    // Варианты ответа (multichoice / truefalse)
    if (q.answers.length > 0) {
        const multi = q.type === 'multichoice' && !q.single;
        q.answers.forEach((answer, i) => {
            const option = document.createElement('div');
            option.className = 'answer-option';
            option.dataset.index = i;

            const letter = document.createElement('div');
            letter.className = 'answer-letter';
            let box = null;
            if (multi) {
                box = document.createElement('input');
                box.type = 'checkbox';
                box.dataset.index = i;
                box.checked = Array.isArray(userAnswers[idx]) && userAnswers[idx].includes(i);
                box.disabled = locked;
                letter.appendChild(box);
            } else {
                letter.textContent = LETTERS[i] || (i + 1);
            }

            const content = renderTextWithMath(answer.text);
            option.appendChild(letter);
            option.appendChild(content);

            // Восстановление выбранного/проверенного состояния
            if (!multi && userAnswers[idx] === i) option.classList.add('selected');
            if (multi && box.checked) option.classList.add('selected');
            if (isChecked(idx)) {
                if (crushMode) {
                    // CrushMode: правильный ответ не раскрываем.
                    // Зелёным — только найденный пользователем верный вариант,
                    // красным — его же неверный выбор
                    if (q.isCorrect && answer.isCorrect) option.classList.add('correct');
                    else if (!q.isCorrect && !multi && i === userAnswers[idx]) option.classList.add('incorrect');
                } else {
                    // CheckMode / обычный режим: выбранный вариант — зелёный (верно)
                    // или красный (ошибка фиксируется), правильный подсвечивается зелёным
                    const chosen = multi ? box.checked : userAnswers[idx] === i;
                    if (chosen) option.classList.add(answer.isCorrect ? 'correct' : 'incorrect');
                    if (answer.isCorrect) option.classList.add('correct');
                }
            }

            if (locked) option.classList.add('locked');
            option.addEventListener('click', () => selectAnswer(i));
            card.appendChild(option);
        });
    }

    // Фидбек по проверенному вопросу (CheckMode) — выводится под вариантами.
    // Кнопка «Проверить ответ» находится внизу панели (единая, без дублей).
    if (checkMode && !crushMode && isChecked(idx)) {
        const feedback = document.createElement('div');
        feedback.className = 'check-feedback';
        restoreFeedback(idx, feedback);
        card.appendChild(feedback);
    }

    questionsContainer.appendChild(card);

    // Обновление счётчиков и навигации
    updateCounters();

    applyMathJax();
}

// Поле ручного ввода ответа (shortanswer / numerical)
function buildTextInputAnswer(q, idx, locked) {
    const wrap = document.createElement('div');
    wrap.className = 'text-answer-wrap';
    const input = document.createElement('input');
    input.type = q.type === 'numerical' ? 'number' : 'text';
    input.step = 'any';
    input.className = 'text-answer-input';
    input.placeholder = q.type === 'numerical' ? 'Введите число' : 'Введите ответ';
    input.value = userTextAnswers[idx] || '';
    input.disabled = locked;
    if (isChecked(idx)) {
        input.classList.add(q.isCorrect ? 'correct' : 'incorrect');
    }
    input.addEventListener('input', () => {
        userTextAnswers[idx] = input.value;
        if (crushMode && crushState === CRUSH_STATE.CORRECT) {
            crushState = CRUSH_STATE.ANSWERING;   // при правке ответ нужно проверить заново
        }
        updateNavigation();
    });
    wrap.appendChild(input);
    if (q.type === 'shortanswer') {
        const hint = document.createElement('div');
        hint.className = 'text-answer-hint';
        hint.textContent = 'Допускаются варианты написания, указанные в эталонных ответах';
        wrap.appendChild(hint);
    }
    return wrap;
}

// Сборка HTML текста cloze-вопроса с интерактивными пропусками
function buildClozeQuestionHtml(q, container) {
    const parts = String(q.text || '').split(/(\{\.\.\.[^{}]*\})/g);
    let bi = 0;
    parts.forEach(part => {
        const m = part.match(/^\{\.\.\.:([^{}]+)\}$/);
        if (!m) {
            if (part) container.appendChild(renderTextWithMath(part));
            return;
        }
        const blank = q.clozeBlanks[bi];
        const span = document.createElement('span');
        span.className = 'cloze-blank';
        span.dataset.bi = bi;
        if (blank) {
            const checked = isChecked(currentQuestionIndex);
            if (blank.type === 'MCMS') {
                const sel = document.createElement('select');
                sel.dataset.clozeBlank = bi;
                sel.disabled = checked && !crushMode ? true : false;
                const ph = document.createElement('option');
                ph.value = ''; ph.textContent = '—';
                sel.appendChild(ph);
                blank.answers.forEach(a => {
                    const o = document.createElement('option');
                    o.value = a.text; o.textContent = a.text;
                    sel.appendChild(o);
                });
                if (userClozeAnswers[currentQuestionIndex]?.[bi] != null) {
                    sel.value = userClozeAnswers[currentQuestionIndex][bi];
                }
                if (checked) {
                    const okHere = blank.answers.some(a => a.correct && a.text === sel.value);
                    sel.classList.add(okHere ? 'correct' : 'incorrect');
                }
                sel.addEventListener('change', () => saveClozeValue(sel, bi));
                span.appendChild(sel);
            } else {
                const inp = document.createElement('input');
                inp.type = blank.type === 'NUMERICAL' ? 'number' : 'text';
                inp.step = 'any';
                inp.dataset.clozeBlank = bi;
                inp.placeholder = blank.type === 'NUMERICAL' ? 'число' : 'ответ';
                inp.disabled = checked && !crushMode ? true : false;
                if (userClozeAnswers[currentQuestionIndex]?.[bi] != null) inp.value = userClozeAnswers[currentQuestionIndex][bi];
                if (checked) {
                    const okHere = matchShortAnswer(inp.value, blank.answers);
                    inp.classList.add(okHere ? 'correct' : 'incorrect');
                }
                inp.addEventListener('input', () => saveClozeValue(inp, bi));
                span.appendChild(inp);
            }
        }
        container.appendChild(span);
        bi++;
    });
}

// Сохранение значения пропуска в модель и активация кнопки проверки
function saveClozeValue(el, bi) {
    const arr = userClozeAnswers[currentQuestionIndex] || (userClozeAnswers[currentQuestionIndex] = {});
    arr[bi] = el.tagName === 'SELECT' ? (el.value || null) : (el.value.trim() || null);
    if (crushMode && crushState === CRUSH_STATE.CORRECT) crushState = CRUSH_STATE.ANSWERING;
    updateNavigation();
}

// Вопрос-описание (instruction) — ответа нет, проверять нечего
function q0typeIsDescription(idx) {
    return !!(questions[idx] && questions[idx].type === 'description');
}

function updateCounters() {
    currentQuestionElement.textContent = currentQuestionIndex + 1;
    progressFill.style.width = ((currentQuestionIndex + 1) / questions.length * 100) + '%';
    prevBtn.disabled = currentQuestionIndex === 0;
    updateNavigation();
}

function isChecked(idx) {
    return checkMode ? checkedQuestions[idx] : q_wasChecked(idx);
}

// В crushMode вопрос считается проверенным, если по нему уже вынесен вердикт
function q_wasChecked(idx) {
    return questions[idx]._checked === true;
}

// ===== Выбор варианта ответа =====
function selectAnswer(i) {
    // CheckMode (без CrushMode): после проверки ошибка зафиксирована, менять ответ нельзя
    if (checkMode && !crushMode && checkedQuestions[currentQuestionIndex]) return;
    // CrushMode: выбор заблокирован только после верного ответа (до «Дальше →»)
    if (crushMode && crushState === CRUSH_STATE.CORRECT && !q0typeIsDescription(currentQuestionIndex)) return;

    const q = questions[currentQuestionIndex];
    if (!q || i < 0 || i >= q.answers.length) return;

    // Множественный выбор (single=false): клик переключает чекбокс, ответ — массив индексов
    if (q.type === 'multichoice' && !q.single) {
        let sel = Array.isArray(userAnswers[currentQuestionIndex])
            ? [...userAnswers[currentQuestionIndex]] : [];
        sel = sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i].sort((a, b) => a - b);
        userAnswers[currentQuestionIndex] = sel;

        const options = questionsContainer.querySelectorAll('.answer-option');
        options.forEach((el, idx) => {
            const box = el.querySelector('input[type="checkbox"]');
            const on = sel.includes(idx);
            if (box) box.checked = on;
            el.classList.toggle('selected', on);
            if (crushMode) el.classList.remove('correct', 'incorrect');
        });
        updateNavigation();
        return;
    }

    userAnswers[currentQuestionIndex] = i;

    const options = questionsContainer.querySelectorAll('.answer-option');
    options.forEach((el, idx) => {
        el.classList.toggle('selected', idx === i);
        if (crushMode) {
            // при повторном выборе до новой проверки снимаем старую подсветку
            el.classList.remove('correct', 'incorrect');
        }
    });
}

// ===== Единая кнопка «Проверить ответ» =====
// В CrushMode работает по правилам режима дробления (верно -> зелёный + «Дальше →»,
// неверно -> красный + повторный выбор, 3 ошибки -> возврат к началу).
// В CheckMode фиксация ответа и раскрытие правильного обрабатываются в checkCurrentAnswer.
function handleCheckClick() {
    if (crushMode) handleCrushCheck();
    else checkCurrentAnswer();
}

// ===== Проверка ответа (CheckMode / обычный режим) =====
// Единая точка проверки для всех типов вопросов: multichoice (в т.ч. множественный
// выбор), truefalse, shortanswer, numerical, cloze. Ответ фиксируется, ошибка
// подсвечивается красным, правильный вариант — зелёным; количество ошибок не
// ограничено, переход дальше открыт сразу после получения ответа.
function checkCurrentAnswer() {
    const idx = currentQuestionIndex;
    const q = questions[idx];

    if (!hasAnswer(idx)) {
        showNoSelectionHint();
        return false;
    }

    const ev = evaluateQuestion(q, idx);
    const isCorrect = ev.correct;
    q.isCorrect = isCorrect;
    // Вопрос помечен проверенным всегда — так «пройденные» вопросы корректно
    // засчитываются в результатах, если проверка шла кнопкой
    q._checked = true;

    if (q.type === 'cloze') {
        // Подсветка пропусков: верные — зелёные, неверные — красные;
        // правильные значения не раскрываем (подсказку даёт фидбек)
        q.clozeBlanks.forEach((b, bi) => {
            const el = questionsContainer.querySelector(`[data-cloze-blank="${bi}"]`);
            if (!el) return;
            const v = getClozeValue(idx, bi);
            const okHere = b.type === 'MCMS'
                ? b.answers.some(a => a.correct && a.text === v)
                : matchShortAnswer(v, b.answers);
            el.classList.add(okHere ? 'correct' : 'incorrect');
            el.disabled = !(crushMode && !isCorrect);
        });
    } else if (q.type === 'shortanswer' || q.type === 'numerical') {
        const input = questionsContainer.querySelector('.text-answer-input');
        if (input) {
            input.classList.add(isCorrect ? 'correct' : 'incorrect');
            input.disabled = !(crushMode && !isCorrect);
        }
    } else {
        // Подсветка вариантов (multichoice / truefalse)
        const multi = q.type === 'multichoice' && !q.single;
        const sel = userAnswers[idx];
        const options = questionsContainer.querySelectorAll('.answer-option');
        options.forEach((el, i) => {
            el.classList.remove('correct', 'incorrect');
            if (crushMode) {
                // CrushMode: правильный ответ НЕ раскрываем до того, как студент
                // найдёт его сам. Зелёным — найденный верный вариант (в т.ч. каждый
                // из выбранных при множественном выборе), красным — неверный выбор
                const chosen = multi ? (Array.isArray(sel) && sel.includes(i)) : i === sel;
                if (chosen && q.answers[i].isCorrect) el.classList.add('correct');
                else if (chosen) el.classList.add('incorrect');
            } else {
                // CheckMode / обычный режим: выбранный вариант — зелёный (верно) или
                // красный (ошибка фиксируется), правильный подсвечивается зелёным
                const chosen = multi ? (Array.isArray(sel) && sel.includes(i)) : i === sel;
                if (chosen) el.classList.add(q.answers[i].isCorrect ? 'correct' : 'incorrect');
                if (q.answers[i].isCorrect) el.classList.add('correct');
            }
        });
    }

    // Тексты правильных ответов сохраняем для фидбэка (выводится в CheckMode;
    // в CrushMode ответ не раскрываем). Для текстовых типов — эталонные ответы.
    if (!crushMode) {
        let correctTexts = [];
        if (q.type === 'cloze') {
            correctTexts = q.clozeBlanks.map(b => (b.answers.find(a => a.correct) || b.answers[0] || {}).text).filter(Boolean);
        } else {
            correctTexts = (q.type === 'shortanswer' || q.type === 'numerical')
                ? q.answers.map(a => a.text)
                : q.answers.filter(a => a.isCorrect).map(a => a.text);
        }
        feedbackStore[idx] = { ok: isCorrect, correctTexts };
    }

    if (checkMode && !crushMode) {
        // CheckMode: ошибка фиксируется, изменить ответ нельзя;
        // количество ошибок не ограничено, переход дальше открыт
        checkedQuestions[idx] = true;
        renderCheckFeedback();
    }

    updateNavigation();
    return isCorrect;
}

// Сообщение «сначала дайте ответ» — в фидбэке (CheckMode) или всплывающе
function showNoSelectionHint() {
    const fb = questionsContainer.querySelector('.check-feedback');
    if (fb) {
        fb.innerHTML = '<span style="color:#b45309; font-weight:600;">⚠ Сначала дайте ответ на вопрос</span>';
    } else {
        alert('Сначала дайте ответ на вопрос');
    }
}

// Вывод фидбэка под вариантами ответа (CheckMode без CrushMode)
function renderCheckFeedback() {
    let fb = questionsContainer.querySelector('.check-feedback');
    if (!fb) {
        const card = questionsContainer.querySelector('.question');
        if (!card) return;
        fb = document.createElement('div');
        fb.className = 'check-feedback';
        card.appendChild(fb);
    }
    fillFeedback(fb, feedbackStore[currentQuestionIndex]);
}

function fillFeedback(container, data) {
    container.innerHTML = '';
    const status = document.createElement('div');
    status.className = `status-badge ${data.ok ? 'correct' : 'incorrect'}`;
    status.textContent = data.ok ? '✓ Правильно!' : '✗ Неверно';
    container.appendChild(status);

    if (!data.ok && data.correctTexts && data.correctTexts.length > 0) {
        const line = document.createElement('div');
        line.className = 'answer-line';
        const label = document.createElement('span');
        label.className = 'answer-label';
        label.textContent = 'Правильный ответ:';
        line.appendChild(label);
        data.correctTexts.forEach(txt => line.appendChild(renderTextWithMath(txt)));
        container.appendChild(line);
    }
    applyMathJax();
}

function restoreFeedback(idx, container) {
    if (feedbackStore[idx]) fillFeedback(container, feedbackStore[idx]);
}

// ===== Навигация =====
function goToQuestion(idx) {
    if (idx < 0 || idx >= questions.length) return;
    if (crushMode) {
        // В CrushMode «Назад» запрещён; вперёд — только после верного ответа
        // (или если текущий вопрос — описание без ответа)
        if (idx < currentQuestionIndex) return;
        if (idx > currentQuestionIndex && crushState !== CRUSH_STATE.CORRECT &&
            !q0typeIsDescription(currentQuestionIndex)) return;
    }
    currentQuestionIndex = idx;
    renderQuestion();
}

// Вопрос «пройден» в CrushMode, если на него уже получен верный ответ
function q_isCrushPassed(idx) {
    return questions[idx]._checked === true && questions[idx].isCorrect === true;
}

// Единая кнопка движения вперёд («Вперёд →» / «Дальше →»).
// В CrushMode переход возможен только после верного ответа (кнопка скрыта до него),
// на последнем вопросе вместо неё показывается «Завершить тест».
function handleNext() {
    // В CrushMode вперёд пускаем только после верного ответа
    // (вопрос-описание проходится без ответа)
    if (crushMode && crushState !== CRUSH_STATE.CORRECT &&
        !q0typeIsDescription(currentQuestionIndex)) return;
    if (currentQuestionIndex < questions.length - 1) {
        goToQuestion(currentQuestionIndex + 1);
        // Переход выполнен — состояние «верно» больше не нужно: сбрасываем его,
        // иначе на следующем вопросе кнопка проверки осталась бы заблокированной
        if (crushMode && crushState === CRUSH_STATE.CORRECT) {
            crushState = CRUSH_STATE.ANSWERING;
            updateNavigation();
        }
    } else {
        finishTest();
    }
}

// ===== CrushMode =====
// Единая кнопка «Проверить ответ»: верный ответ -> зелёная подсветка + открывается
// «Дальше →»; неверный -> красная подсветка выбранного варианта, можно выбрать другой
// ответ (или исправить ввод) и проверить снова. Три ошибки за сессию -> возврат к началу
// теста. Работает со всеми типами вопросов (multichoice, truefalse, shortanswer,
// numerical, cloze). Вопросы идут в порядке расположения в тесте, варианты ответов
// перемешаны, возврат к предыдущим вопросам невозможен (только вперёд).
function handleCrushCheck() {
    // После 3 ошибок проверка блокируется до перезапуска сессии
    if (crushState === CRUSH_STATE.RESTART) return;
    // Ответ уже верный — повторная проверка не нужна
    if (crushState === CRUSH_STATE.CORRECT) return true;

    if (!hasAnswer(currentQuestionIndex)) {
        alert('Сначала дайте ответ на вопрос');
        return;
    }

    const isCorrect = checkCurrentAnswer();

    if (isCorrect) {
        // Верно: вариант подсвечен зелёным, открываем кнопку «Дальше →»
        crushState = CRUSH_STATE.CORRECT;
        updateNavigation();
    } else {
        // Неверно: ответ подсвечен красным, доступ к выбору другого ответа открыт
        crushErrors++;
        updateCrushAttemptsPill();

        if (crushErrors >= CRUSH_MAX_ERRORS) {
            crushState = CRUSH_STATE.RESTART;
            updateNavigation();
            alert(`Допущено ${CRUSH_MAX_ERRORS} ошибки. Тест начнётся заново!`);
            restartCrushSession();
        } else {
            // Правильный ответ не раскрываем — только сообщение об ошибке
            alert(`Неверно! Дайте другой ответ и проверьте снова. Осталось попыток: ${CRUSH_MAX_ERRORS - crushErrors}`);
        }
    }
}


// Перезапуск сессии в CrushMode (после трёх ошибок): возврат к первому вопросу
function restartCrushSession() {
    crushErrors = 0;
    crushState = CRUSH_STATE.ANSWERING;
    userAnswers = new Array(questions.length).fill(null);
    userTextAnswers = new Array(questions.length).fill('');
    userClozeAnswers = new Array(questions.length).fill(null);
    checkedQuestions = new Array(questions.length).fill(false);
    feedbackStore = new Array(questions.length).fill(null);
    questions.forEach(q => { q.isCorrect = false; q._checked = false; });
    currentQuestionIndex = 0;
    updateCrushAttemptsPill();
    // Вопросы остаются в прежнем порядке (последовательность),
    // варианты ответов перемешиваются заново
    shuffleAnswers();
    renderQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Итоговая сводка (последний шаг) =====
function addSummaryRow(container, label, value) {
    const row = document.createElement('div');
    row.className = 'summary-row';

    const l = document.createElement('span');
    l.className = 'summary-label';
    l.textContent = label;

    const v = document.createElement('span');
    v.className = 'summary-value';
    v.textContent = value;

    row.appendChild(l);
    row.appendChild(v);
    container.appendChild(row);
    return row;
}

function renderResultsSummary(endDateTimeStr, grade) {
    resultsSummary.innerHTML = '';

    // 1. ФИО студента
    addSummaryRow(resultsSummary, 'Студент', studentName || '—');

    // 2. Дата и время окончания теста
    addSummaryRow(resultsSummary, 'Дата и время окончания теста', endDateTimeStr);

    // 3. Название темы — только если в XML есть <topicName>
    if (testTopicName) {
        addSummaryRow(resultsSummary, 'Тема', testTopicName);
    }

    // 4. Полученная оценка
    addSummaryRow(resultsSummary, 'Оценка', String(grade));

    // 5. Затраченное время
    addSummaryRow(resultsSummary, 'Затраченное время', formatTime(timeSpent));
}

// ===== Завершение теста =====
function finishTest() {
    // неотвеченные — без ответа любого типа (описание всегда «отвечено»)
    const unanswered = questions.filter((q, i) => !hasAnswer(i)).length;
    if (unanswered > 0 && !crushMode) {
        if (!confirm(`У вас ${unanswered} неотвеченных вопрос(ов). Завершить тест?`)) return;
    }

    // Остановка таймера
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }

    // Подсчёт результатов: вердикт по каждому вопросу через единый оценщик
    // (учитывает множественный выбор, текст с эталонами, число с допуском, cloze;
    // вопросы-описания не влияют на оценку — исключены из знаменателя)
    const gradable = questions.filter(q => q.type !== 'description');
    const total = gradable.length;
    const correct = gradable.filter(q => evaluateQuestion(q, questions.indexOf(q)).correct).length;
    const pct = total > 0 ? Math.round(correct / total * 100) : 0;
    const grade = GRADE_THRESHOLDS.find(t => pct >= t.min)?.grade ?? 2;

    // Заполнение интерфейса
    testSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');

    correctAnswersElement.textContent = correct;
    totalAnswersElement.textContent = total;
    timeSpentElement.textContent = formatTime(timeSpent);
    scoreElement.textContent = pct + '%';

    gradePill.className = 'grade-pill grade-' + grade;
    gradePill.textContent = 'Оценка: ' + grade;

    // Анимация кольца
    scoreRing.style.strokeDashoffset = SCORE_RING_LENGTH;
    setTimeout(() => {
        scoreRing.style.strokeDashoffset = SCORE_RING_LENGTH - (SCORE_RING_LENGTH * pct / 100);
    }, 100);

    // Итоговая сводка: ФИО → дата/время окончания → тема (если есть) → оценка → время
    const endDateTimeStr = new Date().toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    renderResultsSummary(endDateTimeStr, grade);

    renderDetailedResults();
    applyMathJax();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== Детальные результаты: только правильно отвеченные вопросы =====
function renderDetailedResults() {
    detailedResults.innerHTML = '';

    const title = document.createElement('h3');
    title.className = 'detail-title';
    title.textContent = 'Разбор ответов';
    detailedResults.appendChild(title);

    const note = document.createElement('p');
    note.className = 'detail-note';
    note.textContent = 'Показаны только вопросы, на которые был дан правильный ответ';
    detailedResults.appendChild(note);

    // Индексы вопросов, на которые получен правильный ответ (единый оценщик —
    // корректно для всех типов: выбор, текст, число с допуском, cloze)
    const correctIndexes = questions
        .map((q, i) => i)
        .filter(i => evaluateQuestion(questions[i], i).correct);

    if (correctIndexes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-note';
        empty.textContent = 'Нет вопросов, отвеченных правильно';
        detailedResults.appendChild(empty);
        return;
    }

    correctIndexes.forEach(i => {
        const q = questions[i];
        const item = document.createElement('div');
        item.className = 'detail-item';

        const status = document.createElement('div');
        status.className = 'status-badge correct';
        status.textContent = `Вопрос ${i + 1}. ✓ Верно`;
        item.appendChild(status);

        // Текст вопроса (HTML + LaTeX)
        item.appendChild(renderTextWithMath(q.text));

        // Ответ (он же правильный, т.к. вопрос отвечен верно)
        const answerLine = document.createElement('div');
        answerLine.className = 'answer-line';
        const al = document.createElement('span');
        al.className = 'answer-label';
        al.textContent = 'Ответ:';
        answerLine.appendChild(al);
        if (q.type === 'cloze') {
            // значения пропусков из эталонных ответов
            q.clozeBlanks.forEach(b => {
                const a = b.answers.find(x => x.correct) || b.answers[0];
                if (a) answerLine.appendChild(renderTextWithMath(a.text));
            });
        } else if (q.type === 'shortanswer' || q.type === 'numerical') {
            // показываем то, что ввёл студент (совпало с эталоном)
            answerLine.appendChild(renderTextWithMath(userTextAnswers[i] || ''));
        } else {
            q.answers.filter(a => a.isCorrect).forEach(a => {
                answerLine.appendChild(renderTextWithMath(a.text));
            });
        }
        item.appendChild(answerLine);

        detailedResults.appendChild(item);
    });
}

// ===== Обработчики событий =====
loadUrlBtn.addEventListener('click', handleUrlLoad);
qrCodeBtn.addEventListener('click', startQRScanner);
yandexBtn.addEventListener('click', handleYandexLoad);
demoBtn.addEventListener('click', window.loadExampleTest);
closeQrBtn.addEventListener('click', stopQRScanner);
confirmNameBtn.addEventListener('click', confirmName);

urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleUrlLoad(); });
[lastNameInput, firstNameInput, middleNameInput].forEach(inp =>
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmName(); })
);

prevBtn.addEventListener('click', () => goToQuestion(currentQuestionIndex - 1));
nextBtn.addEventListener('click', handleNext);
finishBtn.addEventListener('click', finishTest);
checkAnswerBtn.addEventListener('click', handleCheckClick);

restartBtn.addEventListener('click', () => startTest());
changeNameBtn.addEventListener('click', openNameOverlay);

// ===== Инициализация =====
function init() {
    // Флаги режимов из URL
    checkMode = getUrlFlag('CheckMode');
    crushMode = getUrlFlag('CrushMode');
    randomMode = getUrlFlag('RandomMode');
    headerShow = getUrlFlag('HeaderShow');

    // CheckMode совместим с любым режимом: он только включает кнопку
    // «Проверить ответ» на каждом вопросе. Случайный порядок вопросов
    // задаётся отдельным флагом RandomMode.

    if (checkMode) checkBadge.classList.remove('hidden');
    if (crushMode) {
        crushBadge.classList.remove('hidden');
        crushAttemptsPill.classList.remove('hidden');
    }
    if (headerShow) headerBadge.classList.remove('hidden');

    // Автозагрузка теста из параметров URL
    const testUrl = getTestUrlFromLocation();
    if (testUrl) {
        urlInput.value = testUrl;
        autoLoadTest(testUrl);
    }

    // Окно ввода ФИО
    openNameOverlay();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
