const params = new URLSearchParams(window.location.search);

// Параметры, которые CoovaChilli/Chillispot добавляет при редиректе на портал.
const challenge = params.get("challenge");
const uamip = params.get("uamip");
const uamport = params.get("uamport");
const loginUrl = params.get("loginurl");

// Куда отправить клиента после успешной авторизации — наш экран «Готово».
const SUCCESS_URL = "https://captiveozon.online/?connected=1";

const screenConnect = document.querySelector("#screen-connect");
const screenConnected = document.querySelector("#screen-connected");
const form = document.querySelector("#access-form");
const submit = document.querySelector("#submit");
const message = document.querySelector("#message");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function showConnected() {
  screenConnect.hidden = true;
  screenConnected.hidden = false;
}

// Стандартный UAM login: редирект на http://uamip:uamport/logon с вычисленным response.
function logonUrl(username, response) {
  const base = `http://${uamip}:${uamport}/logon`;
  const query =
    `username=${encodeURIComponent(username)}` +
    `&response=${response}` +
    `&userurl=${encodeURIComponent(SUCCESS_URL)}`;
  return `${base}?${query}`;
}

// Если открыли уже после авторизации — показываем экран успеха с ссылками.
if (params.get("connected") !== null) {
  showConnected();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  setMessage("Подключаем...");

  try {
    // Основной путь: Coova UAM challenge-response.
    if (challenge && uamip && uamport) {
      const res = await fetch(`/api/uam-login?challenge=${encodeURIComponent(challenge)}`);
      const data = await res.json();
      window.location.href = logonUrl(data.username, data.response);
      return;
    }

    // Запасной путь: роутер дал готовый loginurl (простой POST username/password).
    if (loginUrl) {
      const res = await fetch("/api/uam");
      const credentials = await res.json();
      const routerForm = document.createElement("form");
      routerForm.method = "post";
      routerForm.action = loginUrl;
      routerForm.style.display = "none";
      for (const [name, value] of Object.entries({
        username: credentials.username,
        password: credentials.password,
        userurl: SUCCESS_URL
      })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        routerForm.append(input);
      }
      document.body.append(routerForm);
      routerForm.submit();
      return;
    }

    // Нет UAM-параметров — портал открыт напрямую, не через captive-редирект.
    setMessage(
      "Откройте сеть заново через окно авторизации Wi-Fi.",
      true
    );
    submit.disabled = false;
  } catch (error) {
    setMessage(error.message || "Не удалось подключиться. Попробуйте ещё раз.", true);
    submit.disabled = false;
  }
});
