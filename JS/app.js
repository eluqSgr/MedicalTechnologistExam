(() => {
  "use strict";

  // 共通設定
  const STORAGE_KEY = "kensa-study-session";
  const PROGRESS_STORAGE_KEY = "kensa-study-latest-results";
  const FLAG_STORAGE_KEY = "kensa-study-flags";
  const pageName = location.pathname.split("/").pop();
  const circledNumbers = ["①", "②", "③", "④", "⑤"];
  const $ = (selector) => document.querySelector(selector);

  if (pageName === "index.html") {
    const splash = $("#app-splash");
    if (splash && document.documentElement.classList.contains("show-launch-screen")) {
      window.setTimeout(() => {
        splash.classList.add("is-hidden");
        splash.setAttribute("aria-hidden", "true");
        document.documentElement.classList.remove("show-launch-screen");
      }, 1500);
    }
  }

  // 公開サイトを一度開くと、画面・問題・図版を端末に保存してオフライン利用できる。
  async function hasSavedOfflineData() {
    if (!("caches" in window)) return false;

    const cacheNames = (await caches.keys()).filter((name) => name.startsWith("kensa-study-offline-"));
    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const indexResponse = await cache.match(new URL("../data/index.json", location.href));
      if (!indexResponse) continue;

      try {
        const index = await indexResponse.json();
        const dataResponses = await Promise.all(index.files.map((file) =>
          cache.match(new URL(`../data/${file}`, location.href))
        ));
        if (dataResponses.every(Boolean)) return true;
      } catch {
        // 読めないキャッシュは保存済みとして扱わない。
      }
    }
    return false;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      const status = $("#offline-status");
      const savedBeforeOpening = await hasSavedOfflineData();
      if (savedBeforeOpening && status) status.textContent = "データ保存済み";
      if (!savedBeforeOpening && status) status.textContent = "初回データを保存しています。このままお待ちください。";

      try {
        await navigator.serviceWorker.register("./service-worker.js");
        await navigator.serviceWorker.ready;

        const isSaved = await hasSavedOfflineData();
        if (!isSaved) {
          if (status) status.textContent = "保存できませんでした。通信状態を確認して、もう一度開いてください。";
          return;
        }

        if (status) status.textContent = "データ保存済み";
        if (!savedBeforeOpening) {
          window.alert("オフライン用データのダウンロードが完了しました。次回から通信がない場所でも使えます。");
        }
      } catch {
        if (status) status.textContent = "保存できませんでした。SafariまたはChromeでオンライン接続して、もう一度開いてください。";
      }
    });
  } else {
    const status = $("#offline-status");
    if (status) status.textContent = "このブラウザではオフライン保存に対応していません。SafariまたはChromeで開いてください。";
  }

  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    const installButton = $("#install-app");
    if (installButton) installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    const installButton = $("#install-app");
    if (installButton) installButton.hidden = true;
  });

  window.addEventListener("load", () => {
    const installButton = $("#install-app");
    if (!installButton) return;
    installButton.addEventListener("click", async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      installButton.hidden = true;
    });
  });

  // セッション情報
  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }

  function loadProgress() {
    const emptyProgress = { results: {} };

    try {
      const savedProgress = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY));

      return savedProgress?.results ? savedProgress : emptyProgress;
    } catch {
      return emptyProgress;
    }
  }

  function recordAnswer(question, isCorrect) {
    const progress = loadProgress();

    // 同じ問題を解き直した場合は、最新の正誤で上書きする。
    progress.results[question.id] = {
      correct: isCorrect,
      examNumber: question.exam_number,
      session: question.session,
      subject: question.subject,
      answeredAt: new Date().toISOString(),
    };

    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  }

  function loadFlags() {
    try {
      return JSON.parse(localStorage.getItem(FLAG_STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveFlags(flags) {
    localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify(flags));
  }

  function toggleFlag(question) {
    const flags = loadFlags();

    if (flags[question.id]) {
      delete flags[question.id];
    } else {
      // 一覧画面から問題を開けるよう、問題データも一緒に保存する。
      flags[question.id] = {
        question,
        flaggedAt: new Date().toISOString(),
      };
    }

    saveFlags(flags);
    return Boolean(flags[question.id]);
  }

  function sortedNumbers(numbers) {
    return [...numbers].sort((a, b) => a - b);
  }

  function areAnswersEqual(first, second) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
  }

  async function loadQuestions(fileName) {
    const response = await fetch(`../data/${fileName}`);

    if (!response.ok) {
      throw new Error("問題データを読み込めませんでした。");
    }

    return response.json();
  }

  async function loadQuestionFileIndex() {
    const response = await fetch("../data/index.json");

    if (!response.ok) {
      throw new Error("問題ファイル一覧を読み込めませんでした。");
    }

    return response.json();
  }

  function showMessage(message) {
    $(".device__body").innerHTML = `
      <p class="app-message">${message}</p>
      <a class="btn btn-secondary" href="index.html">トップへ戻る</a>
    `;
  }

  // トップ画面
  function setupIndexPage() {
    // 年度選択欄のボタンだけを対象にする（分野選択欄は含めない）。
    const examList = document.querySelectorAll(".list-rows-scrollable")[0];

    examList.querySelectorAll(".list-row").forEach((button) => {
      button.addEventListener("click", () => openExamList(button));
    });

    setupSubjectButtons();
  }

  async function openExamList(button) {
    const selection = getExamSelection(button.textContent);

    if (!selection) {
      return;
    }

    const { exam, session } = selection;
    const fileName = `${exam}_${session}.json`;

    button.disabled = true;

    try {
      const questions = await loadQuestions(fileName);

      saveSession({
        examSelection: { exam, session, fileName, questions },
      });

      location.href = "exam-list.html";
    } catch {
      alert(`${button.textContent.trim()}の問題データは、まだ用意されていません。`);
    } finally {
      button.disabled = false;
    }
  }

  function startExamExercise({ exam, session, fileName, questions }) {
    saveSession({
      file: fileName,
      exam,
      session,
      questions,
      current: 0,
      answers: {},
    });

    location.href = "question.html";
  }

  // 年度別演習の出題順選択画面
  function setupExamModePage() {
    const selection = loadSession()?.examSelection;

    if (!selection?.questions?.length) {
      showMessage("演習する問題をトップ画面から選択してください。");
      return;
    }

    const label = formatExamLabel(selection.fileName);

    $("#exam-mode-title").textContent = `${label}（${selection.questions.length}問）`;
    $("#exam-mode-description").textContent = "出題順を選んでください。";

    document.querySelectorAll("[data-order]").forEach((button) => {
      button.addEventListener("click", () => {
        const questions = button.dataset.order === "random"
          ? shuffleQuestions(selection.questions)
          : selection.questions;

        startExamExercise({
          ...selection,
          questions,
        });
      });
    });
  }

  // 実施回ごとの問題一覧画面
  function setupExamListPage() {
    const session = loadSession();
    const selection = session?.examSelection;

    if (!selection?.questions?.length) {
      showMessage("問題をトップ画面から選択してください。");
      return;
    }

    const examLabel = formatExamLabel(selection.fileName);
    const list = $("#exam-question-list");
    const latestResults = loadProgress().results;

    $("#exam-list-topbar-title").textContent = examLabel;
    $("#exam-list-title").textContent = `${examLabel}（${selection.questions.length}問）`;

    $("#test-mode-button").addEventListener("click", () => {
      location.href = "exam-mode.html";
    });

    selection.questions.forEach((question) => {
      const result = latestResults[question.id];
      const status = getQuestionStatus(result);
      const button = document.createElement("button");

      button.type = "button";
      button.className = "list-row";
      button.innerHTML = `
        <span>第${question.number}問　${question.subject}</span>
        <span class="row-end">${status}<span class="row-arrow">›</span></span>
      `;

      button.addEventListener("click", () => {
        saveSession({
          ...session,
          title: `${examLabel} 第${question.number}問`,
          questions: [question],
          current: 0,
          answers: {},
          singleQuestion: true,
          returnPage: "exam-list.html",
        });

        location.href = "question.html";
      });

      list.append(button);
    });
  }

  function getQuestionStatus(result) {
    if (!result) {
      return "";
    }

    if (result.correct) {
      return '<span class="question-status question-status--correct" aria-label="前回は正解">○</span>';
    }

    return '<span class="question-status question-status--incorrect" aria-label="前回は不正解">×</span>';
  }

  function setupSubjectButtons() {
    // 2つ目のスクロール欄が、分野選択欄。
    const subjectList = document.querySelectorAll(".list-rows-scrollable")[1];

    subjectList.querySelectorAll("[data-subject]").forEach((button) => {
      button.addEventListener("click", async () => {
        const subject = button.dataset.subject;

        button.disabled = true;

        try {
          const { files } = await loadQuestionFileIndex();
          const questionSets = await Promise.all(
            files.map(async (fileName) => ({ fileName, questions: await loadQuestions(fileName) }))
          );
          const availableSets = questionSets
            .map(({ fileName, questions }) => ({
              fileName,
              questions: questions
                .filter((question) => question.subject === subject)
                .map((question) => ({ ...question, sourceFile: fileName })),
            }))
            .filter(({ questions }) => questions.length);

          if (!availableSets.length) {
            alert(`${subject}の問題は、まだ登録されていません。`);
            return;
          }

          const subjectQuestions = availableSets.flatMap(({ questions }) => questions);

          saveSession({
            subject,
            subjectQuestions,
          });

          location.href = "subject.html";
        } catch {
          alert("問題データを読み込めませんでした。index.jsonの内容を確認してください。");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function formatExamLabel(fileName) {
    const matched = fileName.match(/(\d+)_(AM|PM)\.json/);

    if (!matched) {
      return fileName;
    }

    return `第${matched[1]}回 ${matched[2] === "AM" ? "午前" : "午後"}`;
  }

  function shuffleQuestions(questions) {
    const shuffled = [...questions];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
    }

    return shuffled;
  }

  // 例: 「第72回 午前」から { exam: "72", session: "AM" } を作る。
  function getExamSelection(label) {
    const matched = label.match(/第(\d+)回\s*(午前|午後)/);

    if (!matched) {
      return null;
    }

    return {
      exam: matched[1],
      session: matched[2] === "午前" ? "AM" : "PM",
    };
  }

  // 問題画面
  function setupQuestionPage() {
    const session = loadSession();

    if (!session?.questions?.length) {
      showMessage("演習する問題をトップ画面から選択してください。");
      return;
    }

    const reviewId = new URLSearchParams(location.search).get("review");
    const questionIndex = reviewId
      ? session.questions.findIndex((question) => question.id === reviewId)
      : session.current;
    const question = session.questions[questionIndex];

    if (!question) {
      showMessage("問題が見つかりませんでした。");
      return;
    }

    const isReviewMode = Boolean(reviewId);
    let selectedAnswers = [...(session.answers[question.id]?.selected || [])];
    let isAnswered = Boolean(isReviewMode || session.answers[question.id]);

    renderQuestionHeader(session, question, questionIndex);
    renderQuestionText(question);
    setupFlagButton(question);
    renderChoices(question, selectedAnswers, isAnswered, (answers) => {
      selectedAnswers = answers;
    });

    const actionButton = $("#question-action");

    if (isAnswered) {
      showAnswerResult(question, selectedAnswers);
      actionButton.textContent = getNextButtonText(isReviewMode, questionIndex, session.questions.length, session.singleQuestion);
    }

    actionButton.addEventListener("click", () => {
      if (!isAnswered) {
        if (!selectedAnswers.length) {
          alert("回答を1つ以上選択してください。");
          return;
        }

        const isCorrect = areAnswersEqual(sortedNumbers(selectedAnswers), sortedNumbers(question.answer));

        session.answers[question.id] = {
          selected: selectedAnswers,
          correct: isCorrect,
        };
        saveSession(session);
        recordAnswer(question, isCorrect);

        isAnswered = true;
        showAnswerResult(question, selectedAnswers);
        actionButton.textContent = getNextButtonText(false, questionIndex, session.questions.length, session.singleQuestion);
        return;
      }

      if (session.singleQuestion) {
        location.href = session.returnPage || "subject.html";
        return;
      }

      if (isReviewMode || questionIndex === session.questions.length - 1) {
        location.href = "result.html";
        return;
      }

      session.current = questionIndex + 1;
      saveSession(session);
      location.href = "question.html";
    });
  }

  function renderQuestionHeader(session, question, questionIndex) {
    const sessionLabel = session.session === "AM" ? "午前" : "午後";
    const progress = ((questionIndex + 1) / session.questions.length) * 100;

    $("#exam-title").textContent = session.title || `第${session.exam}回 ${sessionLabel}`;
    $("#question-count").textContent = `問 ${question.number} / ${session.questions.length}`;
    $("#question-subject").textContent = question.subject;
    $("#progress-bar").style.width = `${progress}%`;
  }

  function renderQuestionText(question) {
    $("#question-text").textContent = question.question;

    question.image.forEach((imagePath, index) => {
      const image = document.createElement("img");
      image.className = "q-image";
      image.src = `../images/${imagePath}`;
      image.alt = `問題画像 ${index + 1}`;
      $("#question-images").append(image);
    });
  }

  function setupFlagButton(question) {
    const button = $("#flag-button");

    function updateButton(isFlagged) {
      button.setAttribute("aria-pressed", String(isFlagged));
      button.textContent = isFlagged ? "⚑ フラグを外す" : "⚐ フラグを付ける";
    }

    updateButton(Boolean(loadFlags()[question.id]));

    button.addEventListener("click", () => {
      updateButton(toggleFlag(question));
    });
  }

  function renderChoices(question, selectedAnswers, isAnswered, onChange) {
    const choicesElement = $("#choices");

    question.choices.forEach((choiceText, index) => {
      const choiceNumber = index + 1;
      const label = document.createElement("label");

      label.className = "choice";
      label.innerHTML = `
        <input type="checkbox" value="${choiceNumber}">
        <span class="choice-num">${circledNumbers[index] || choiceNumber}</span>
        <span>${choiceText}</span>
      `;

      const checkbox = label.querySelector("input");
      checkbox.checked = selectedAnswers.includes(choiceNumber);
      checkbox.disabled = isAnswered;

      checkbox.addEventListener("change", () => {
        const currentAnswers = [...choicesElement.querySelectorAll("input:checked")].map((input) => Number(input.value));
        onChange(currentAnswers);
      });

      choicesElement.append(label);
    });
  }

  function showAnswerResult(question, selectedAnswers) {
    const correctAnswers = sortedNumbers(question.answer);
    const userAnswers = sortedNumbers(selectedAnswers);

    $("#choices").querySelectorAll("label").forEach((label, index) => {
      const choiceNumber = index + 1;

      if (correctAnswers.includes(choiceNumber)) {
        label.classList.add("choice--correct");
        label.insertAdjacentHTML("beforeend", '<span class="choice-tag">正解</span>');
      }

      if (userAnswers.includes(choiceNumber) && !correctAnswers.includes(choiceNumber)) {
        label.classList.add("choice--incorrect");
        label.insertAdjacentHTML("beforeend", '<span class="choice-tag">あなたの回答</span>');
      }
    });

  }

  function getNextButtonText(isReviewMode, questionIndex, questionCount, isSingleQuestion) {
    if (isReviewMode) {
      return "結果へ戻る";
    }

    if (isSingleQuestion) {
      return "問題一覧に戻る";
    }

    return questionIndex === questionCount - 1 ? "結果を見る" : "次の問題へ";
  }

  // 結果画面
  function setupResultPage() {
    const session = loadSession();

    if (!session?.questions?.length) {
      showMessage("表示できる演習結果がありません。");
      return;
    }

    const answers = session.answers || {};
    const correctCount = session.questions.filter((question) => answers[question.id]?.correct).length;
    const incorrectQuestions = session.questions.filter((question) => answers[question.id] && !answers[question.id].correct);

    $("#result-title").textContent = session.title ? `${session.subject}・結果` : `第${session.exam}回・結果`;
    $("#score-num").textContent = `${correctCount} / ${session.questions.length}`;
    $("#score-rate").textContent = `正答率 ${Math.round((correctCount / session.questions.length) * 100)}%`;

    renderIncorrectQuestions(incorrectQuestions);
    setupRetryButton(session);
  }

  // 分野別問題一覧画面
  function setupSubjectListPage() {
    const session = loadSession();

    if (!session?.subjectQuestions?.length) {
      showMessage("表示できる分野別問題がありません。");
      return;
    }

    $("#subject-list-title").textContent = `${session.subject}の問題`;
    const list = $("#subject-question-list");
    const latestResults = loadProgress().results;

    session.subjectQuestions.forEach((question) => {
      const button = document.createElement("button");
      const status = getQuestionStatus(latestResults[question.id]);

      button.type = "button";
      button.className = "list-row";
      button.innerHTML = `
        <span>${formatExamLabel(question.sourceFile)} 第${question.number}問</span>
        <span class="row-end">${status}<span class="row-arrow">›</span></span>
      `;

      button.addEventListener("click", () => {
        saveSession({
          ...session,
          title: `${session.subject}・${formatExamLabel(question.sourceFile)} 第${question.number}問`,
          questions: [question],
          current: 0,
          answers: {},
          singleQuestion: true,
        });

        location.href = "question.html";
      });

      list.append(button);
    });
  }

  // フラグ問題一覧画面
  function setupFlagListPage() {
    const flags = loadFlags();
    const flaggedQuestions = Object.values(flags)
      .sort((first, second) => new Date(second.flaggedAt) - new Date(first.flaggedAt));
    const list = $("#flag-question-list");

    if (!flaggedQuestions.length) {
      list.innerHTML = '<p class="empty-message">フラグを付けた問題はありません。</p>';
      return;
    }

    flaggedQuestions.forEach(({ question }) => {
      const button = document.createElement("button");
      const examLabel = `第${question.exam_number}回 ${question.session === "AM" ? "午前" : "午後"}`;

      button.type = "button";
      button.className = "list-row";
      button.innerHTML = `<span>${examLabel} 第${question.number}問<br><small>${question.subject}</small></span><span class="row-arrow">›</span>`;

      button.addEventListener("click", () => {
        saveSession({
          title: `${examLabel} 第${question.number}問`,
          questions: [question],
          current: 0,
          answers: {},
          singleQuestion: true,
          returnPage: "flag-list.html",
        });

        location.href = "question.html";
      });

      list.append(button);
    });
  }

  // 学習状況画面
  function setupProgressPage() {
    const progress = loadProgress();
    const results = Object.values(progress.results);
    const correctCount = results.filter((result) => result.correct).length;
    const accuracy = results.length ? Math.round((correctCount / results.length) * 100) : 0;

    $("#progress-total").textContent = `${correctCount} / ${results.length}`;
    $("#progress-rate").textContent = results.length
      ? `全体の正答率 ${accuracy}%（最後の回答を反映）`
      : "まだ回答がありません";

    renderProgressList($("#exam-progress-list"), createExamGroups(results), "問題を解くと、ここに回ごとの成績が表示されます。");
    renderProgressList($("#subject-progress-list"), createSubjectGroups(results), "問題を解くと、ここに分野別の成績が表示されます。");
  }

  function createExamGroups(results) {
    const groups = new Map();

    results.forEach((result) => {
      const key = `${result.examNumber}_${result.session}`;
      const group = groups.get(key) || {
        label: `第${result.examNumber}回 ${result.session === "AM" ? "午前" : "午後"}`,
        examNumber: result.examNumber,
        session: result.session,
        answered: 0,
        correct: 0,
      };

      group.answered += 1;
      group.correct += Number(result.correct);
      groups.set(key, group);
    });

    return [...groups.values()].sort((first, second) => {
      if (first.examNumber !== second.examNumber) {
        return second.examNumber - first.examNumber;
      }

      return first.session.localeCompare(second.session);
    });
  }

  function createSubjectGroups(results) {
    const groups = new Map();

    results.forEach((result) => {
      const group = groups.get(result.subject) || {
        label: result.subject,
        answered: 0,
        correct: 0,
      };

      group.answered += 1;
      group.correct += Number(result.correct);
      groups.set(result.subject, group);
    });

    return [...groups.values()].sort((first, second) => first.label.localeCompare(second.label, "ja"));
  }

  function renderProgressList(list, groups, emptyMessage) {
    list.innerHTML = "";

    if (!groups.length) {
      list.innerHTML = `<p class="empty-message">${emptyMessage}</p>`;
      return;
    }

    groups.forEach((group) => {
      const rate = Math.round((group.correct / group.answered) * 100);
      const row = document.createElement("div");

      row.className = "list-row";
      row.innerHTML = `<span>${group.label}</span><span>${group.correct} / ${group.answered}問（${rate}%）</span>`;

      list.append(row);
    });
  }

  function renderIncorrectQuestions(incorrectQuestions) {
    const list = $("#incorrect-list");

    if (!incorrectQuestions.length) {
      list.innerHTML = '<p class="empty-message">間違えた問題はありません。</p>';
      return;
    }

    incorrectQuestions.forEach((question) => {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "list-row";
      button.innerHTML = `<span>問${question.number} ${question.subject}</span><span class="row-arrow">›</span>`;

      button.addEventListener("click", () => {
        location.href = `question.html?review=${encodeURIComponent(question.id)}`;
      });

      list.append(button);
    });
  }

  function setupRetryButton(session) {
    $("#retry-button").addEventListener("click", () => {
      saveSession({
        ...session,
        current: 0,
        answers: {},
      });

      location.href = "question.html";
    });
  }

  // ページごとの初期化
  if (pageName === "index.html") {
    setupIndexPage();
  }

  if (pageName === "question.html") {
    setupQuestionPage();
  }

  if (pageName === "result.html") {
    setupResultPage();
  }

  if (pageName === "subject.html") {
    setupSubjectListPage();
  }

  if (pageName === "progress.html") {
    setupProgressPage();
  }

  if (pageName === "exam-mode.html") {
    setupExamModePage();
  }

  if (pageName === "exam-list.html") {
    setupExamListPage();
  }

  if (pageName === "flag-list.html") {
    setupFlagListPage();
  }
})();
