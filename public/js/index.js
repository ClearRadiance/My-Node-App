
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');

if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const usernameInput = document.querySelector('#username');
        const passwordInput = document.querySelector('#password');
        const rememberInput = document.querySelector('#rememberMe');

        const username = usernameInput?.value.trim();
        const password = passwordInput?.value;
        const rememberMe = rememberInput?.checked || false;

        if (!username || !password) {
            if (loginMessage) {
                loginMessage.textContent =
                    'Please enter your username and password.';
            }
            return;
        }

        if (loginMessage) {
            loginMessage.textContent = 'Logging in...';
        }

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    username,
                    password,
                    rememberMe
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || data.message || 'Login failed.'
                );
            }

            window.location.href = '/dashboard';
        } catch (error) {
            if (loginMessage) {
                loginMessage.textContent = error.message;
            }
        }
    });
}
