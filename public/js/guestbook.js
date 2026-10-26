
let currentUser = null;

async function deleteEntry(id) {
    if (!confirm('Delete this message?')) return;

    const listError = document.querySelector('#list-error');
    listError.textContent = '';

    try {
        const response = await fetch(
            `/api/guestbook/${encodeURIComponent(id)}`,
            { method: 'DELETE' }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            listError.textContent =
                data.error || 'Could not delete that message.';
            return;
        }

        await loadMessages();
    } catch (err) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

async function saveEdit(entry, newMsg) {
    const listError = document.querySelector('#list-error');
    listError.textContent = '';

    if (!newMsg.trim() || newMsg.trim().length > 280) {
        listError.textContent =
            'Message must be between 1 and 280 characters.';
        return;
    }

    try {
        const response = await fetch(
            `/api/guestbook/${encodeURIComponent(entry.id)}`,
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: entry.name,
                    msg: newMsg.trim()
                })
            }
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            listError.textContent =
                data.error || 'Could not save your changes.';
            return;
        }

        await loadMessages();
    } catch (err) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

function startEdit(li, entry) {
    li.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.value = entry.msg;
    textarea.maxLength = 280;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
        saveEdit(entry, textarea.value);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', loadMessages);

    li.append(textarea, saveButton, cancelButton);
    textarea.focus();
}

async function loadMessages() {
    const listError = document.querySelector('#list-error');
    listError.textContent = '';

    try {
        const authResponse = await fetch('/api/whoami');
        const authData = await authResponse.json().catch(() => ({}));

        currentUser = authData.loggedIn ? authData : null;

        const response = await fetch('/api/guestbook');
        const data = await response.json().catch(() => ({}));

        if (!response.ok || !Array.isArray(data)) {
            listError.textContent =
                data.error || 'Could not load messages.';
            return;
        }

        const list = document.querySelector('#guestbook-list');
        list.innerHTML = '';

        [...data].reverse().forEach(entry => {
            const li = document.createElement('li');

            const name = document.createElement('strong');
            name.textContent = entry.name;

            const date = document.createElement('small');
            date.textContent =
                new Date(entry.createdAt).toLocaleString();

            const msg = document.createElement('p');
            msg.textContent = entry.msg;

            li.append(name, ' ', date, msg);

            if (entry.updatedAt) {
                const edited = document.createElement('small');
                edited.textContent = ' (edited)';
                li.append(edited);
            }

            const isAdmin = currentUser?.role === 'admin';
            const ownsEntry =
                currentUser &&
                String(entry.userId) === String(currentUser.userId);

            if (isAdmin || ownsEntry) {
                const editButton = document.createElement('button');
                editButton.type = 'button';
                editButton.textContent = 'Edit';
                editButton.addEventListener('click', () => {
                    startEdit(li, entry);
                });

                const deleteButton = document.createElement('button');
                deleteButton.type = 'button';
                deleteButton.textContent = 'Delete';
                deleteButton.addEventListener('click', () => {
                    deleteEntry(entry.id);
                });

                li.append(editButton, deleteButton);
            }

            list.append(li);
        });
    } catch (err) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

document.querySelector('#guestbook-form').addEventListener(
    'submit',
    async event => {
        event.preventDefault();

        const errorBox = document.querySelector('#form-error');
        errorBox.textContent = '';

        try {
            const response = await fetch('/api/guestbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: document.querySelector('#name').value,
                    msg: document.querySelector('#msg').value
                })
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                errorBox.textContent =
                    data.error || 'Something went wrong. Please try again.';
                return;
            }

            event.target.reset();
            await loadMessages();
        } catch (err) {
            errorBox.textContent =
                'Could not reach the server. Check your connection.';
        }
    }
);

loadMessages();
