const form = document.querySelector("#access-form");
const submit = document.querySelector("#submit");
const message = document.querySelector("#message");
const params = new URLSearchParams(window.location.search);
const loginUrl = params.get("loginurl");
const userUrl = params.get("userurl") || "https://captiveozon.online/";

function setMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function submitToRouter(username, password) {
  const routerForm = document.createElement("form");
  routerForm.method = "post";
  routerForm.action = loginUrl;
  routerForm.style.display = "none";

  const fields = {
    username,
    password,
    userurl: userUrl
  };

  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    routerForm.append(input);
  }

  document.body.append(routerForm);
  routerForm.submit();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  setMessage("Подключаем...");

  try {
    if (loginUrl) {
      const response = await fetch("/api/uam");
      const credentials = await response.json();
      submitToRouter(credentials.username, credentials.password);
      return;
    }

    const payload = {
      name: new FormData(form).get("name") || "",
      redirectTo: userUrl
    };

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.message || "Не удалось выдать доступ.");
    }

    setMessage("Доступ открыт. Перенаправляем...");
    window.location.href = result.redirectTo;
  } catch (error) {
    setMessage(error.message, true);
    submit.disabled = false;
  }
});
