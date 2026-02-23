document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadButton = document.getElementById('uploadButton');
    const fileContent = document.getElementById('fileContent');
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const chatHistory = document.getElementById('chatHistory');
    const exportChatButton = document.getElementById('exportChat');
    const clearChatButton = document.getElementById('clearChat');
    const clearAllButton = document.getElementById('clearAll');
    const dropZone = document.getElementById('dropZone');
    const spinner = document.getElementById('spinner');
    const fileList = document.getElementById('fileList');
    const clearSelectionButton = document.getElementById('clearSelection');
    const fileHint = document.getElementById('fileHint');
    const pendingNote = document.getElementById('pendingNote');
    const autocompleteContainer = document.getElementById('autocompleteContainer');
    const autocompleteList = document.getElementById('autocompleteList');
    const sendButton = chatForm.querySelector('button[type="submit"]');
    
    let lastNoMatchQuestion = '';
    let lastNoMatchMessage = '';
    let selectedFiles = [];
    let lastUploadedKeys = new Set();
    let hasUploaded = false;
    let isGenerating = false;
    let chatAbortController = null;
    let debounceTimer = null;
    let selectedSuggestionIndex = -1;

    const allowedFileTypes = ['.txt', '.md', '.py', '.js', '.html', '.css', '.json', '.pdf', '.xlsx', '.xls', '.csv'];

    // Create loading overlay
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.innerHTML = '<div class="loader"></div>';
    document.body.appendChild(loadingOverlay);

    // Function to show/hide loading overlay
    function setLoading(isLoading) {
        loadingOverlay.style.display = isLoading ? 'flex' : 'none';
    }

    // Function to show/hide spinner
    function setSpinner(isLoading) {
        spinner.style.display = isLoading ? 'block' : 'none';
    }

    function setSendState(isLoading) {
        isGenerating = isLoading;
        if (isLoading) {
            sendButton.textContent = 'Stop';
            sendButton.classList.add('stop-button');
        } else {
            sendButton.textContent = 'Send';
            sendButton.classList.remove('stop-button');
        }
    }

    // Debounce function for autocomplete
    function debounce(func, delay) {
        return function(...args) {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => func(...args), delay);
        };
    }

    // Fetch autocomplete suggestions
    async function fetchAutocompleteSuggestions(query) {
        if (!query || query.length < 1) {
            hideAutocomplete();
            return;
        }

        try {
            const response = await fetch(`/autocomplete?q=${encodeURIComponent(query)}&limit=8`);
            const data = await response.json();
            
            if (data.suggestions && data.suggestions.length > 0) {
                showAutocomplete(data.suggestions);
            } else {
                hideAutocomplete();
            }
        } catch (error) {
            console.error('Autocomplete error:', error);
            hideAutocomplete();
        }
    }

    // Show autocomplete dropdown
    function showAutocomplete(suggestions) {
        autocompleteList.innerHTML = '';
        selectedSuggestionIndex = -1;

        suggestions.forEach((suggestion, index) => {
            const li = document.createElement('li');
            li.className = 'autocomplete-item';
            li.innerHTML = `
                <div class="autocomplete-item-question">${escapedText(suggestion.question)}</div>
                <div class="autocomplete-item-answer">${escapedText(suggestion.answer)}</div>
            `;
            
            li.addEventListener('click', () => {
                selectSuggestion(suggestion);
            });

            li.addEventListener('mouseenter', () => {
                setActiveSuggestion(index);
            });

            autocompleteList.appendChild(li);
        });

        autocompleteContainer.style.display = 'block';
    }

    // Hide autocomplete dropdown
    function hideAutocomplete() {
        autocompleteContainer.style.display = 'none';
        selectedSuggestionIndex = -1;
    }

    // Set active suggestion
    function setActiveSuggestion(index) {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.classList.add('active');
                selectedSuggestionIndex = index;
            } else {
                item.classList.remove('active');
            }
        });
    }

    // Select a suggestion
    function selectSuggestion(suggestion) {
        userInput.value = suggestion.question;
        hideAutocomplete();
        // Optionally auto-submit the form
        // chatForm.dispatchEvent(new Event('submit'));
    }

    // Escape HTML text to prevent XSS
    function escapedText(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Debounced autocomplete event handler
    const handleAutocompleteInput = debounce((e) => {
        const query = e.target.value.trim();
        fetchAutocompleteSuggestions(query);
    }, 200);

    // Input event listener for autocomplete
    userInput.addEventListener('input', handleAutocompleteInput);

    // Keyboard navigation for autocomplete
    userInput.addEventListener('keydown', (e) => {
        const items = autocompleteList.querySelectorAll('.autocomplete-item');
        const itemCount = items.length;

        if (itemCount === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (selectedSuggestionIndex < itemCount - 1) {
                    setActiveSuggestion(selectedSuggestionIndex + 1);
                    items[selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (selectedSuggestionIndex > 0) {
                    setActiveSuggestion(selectedSuggestionIndex - 1);
                    items[selectedSuggestionIndex].scrollIntoView({ block: 'nearest' });
                }
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedSuggestionIndex >= 0) {
                    items[selectedSuggestionIndex].click();
                } else if (userInput.value.trim()) {
                    // Submit form if no suggestion selected but input has text
                    chatForm.dispatchEvent(new Event('submit'));
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideAutocomplete();
                break;
        }
    });

    // Hide autocomplete when clicking outside
    document.addEventListener('click', (e) => {
        if (!userInput.contains(e.target) && !autocompleteContainer.contains(e.target)) {
            hideAutocomplete();
        }
    });

    // Hide autocomplete when form is submitted
    chatForm.addEventListener('submit', () => {
        hideAutocomplete();
    });

    // Load chat history from local storage
    loadChatHistory();

    // Load file content from local storage
    loadFileContent();

    fileInput.addEventListener('change', handleFileSelect);

    // Drag and drop functionality
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files || []);
        addFilesToSelection(files);
    });

    function handleFileSelect(e) {
        const files = Array.from(e.target.files || []);
        addFilesToSelection(files);
    }

    function fileKey(file) {
        return `${file.name}|${file.size}|${file.lastModified}`;
    }

    function isAllowedFile(file) {
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        return allowedFileTypes.includes(fileExtension);
    }

    function updateFileInputFromSelection() {
        const dataTransfer = new DataTransfer();
        selectedFiles.forEach((file) => dataTransfer.items.add(file));
        fileInput.files = dataTransfer.files;
    }

    function updateUploadUi() {
        if (selectedFiles.length === 0) {
            uploadButton.textContent = 'Upload';
            uploadButton.disabled = true;
            fileHint.textContent = 'No files selected.';
            return;
        }

        uploadButton.textContent = selectedFiles.length === 1
            ? 'Upload ' + selectedFiles[0].name
            : 'Upload ' + selectedFiles.length + ' files';
        uploadButton.disabled = false;
        fileHint.textContent = selectedFiles.length + ' file(s) selected.';
    }

    function renderFileList() {
        fileList.innerHTML = '';
        if (selectedFiles.length === 0) {
            updateUploadUi();
            updatePendingNote();
            return;
        }

        selectedFiles.forEach((file) => {
            const chip = document.createElement('div');
            chip.className = 'file-chip';
            chip.textContent = file.name;

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'remove-file';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => {
                removeFileFromSelection(fileKey(file));
            });

            chip.appendChild(removeButton);
            fileList.appendChild(chip);
        });

        updateUploadUi();
        updatePendingNote();
    }

    function addFilesToSelection(files) {
        if (!files.length) {
            return;
        }

        const invalidFiles = files.filter((file) => !isAllowedFile(file));
        if (invalidFiles.length > 0) {
            alert('Invalid file type(s): ' + invalidFiles.map((file) => file.name).join(', '));
        }

        const allowedFiles = files.filter((file) => isAllowedFile(file));
        const existingKeys = new Set(selectedFiles.map(fileKey));
        allowedFiles.forEach((file) => {
            const key = fileKey(file);
            if (!existingKeys.has(key)) {
                selectedFiles.push(file);
                existingKeys.add(key);
            }
        });

        updateFileInputFromSelection();
        renderFileList();
    }

    function removeFileFromSelection(keyToRemove) {
        selectedFiles = selectedFiles.filter((file) => fileKey(file) !== keyToRemove);
        updateFileInputFromSelection();
        renderFileList();
    }

    function setsEqual(a, b) {
        if (a.size !== b.size) {
            return false;
        }
        for (const item of a) {
            if (!b.has(item)) {
                return false;
            }
        }
        return true;
    }

    function updatePendingNote() {
        if (!hasUploaded) {
            pendingNote.style.display = 'none';
            return;
        }

        const currentKeys = new Set(selectedFiles.map(fileKey));
        pendingNote.style.display = setsEqual(currentKeys, lastUploadedKeys) ? 'none' : 'block';
    }

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (selectedFiles.length === 0) {
            alert('Please select at least one file to upload.');
            return;
        }

        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append('file', file));

        // Check if there's existing chat history
        if (chatHistory.innerHTML.trim() !== '') {
            const userChoice = await showUploadConfirmation();
            if (userChoice === 'cancel') {
                return;
            }
            formData.append('action', userChoice);
        } else {
            formData.append('action', 'upload');
        }

        try {
            setLoading(true);
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.error) {
                alert(`Error: ${data.error}`);
                fileContent.textContent = '';
            } else {
                fileContent.textContent = data.content;
                localStorage.setItem('fileContent', data.content); // Store file content in localStorage
                hasUploaded = true;
                lastUploadedKeys = new Set(selectedFiles.map(fileKey));
                updatePendingNote();
                if (data.chatHistory) {
                    updateChatHistory(data.chatHistory);
                }
            }
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while uploading the file.');
            fileContent.textContent = '';
        } finally {
            setLoading(false);
        }
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isGenerating) {
            if (chatAbortController) {
                chatAbortController.abort();
            }
            setSendState(false);
            return;
        }

        const message = userInput.value.trim();
        if (!message) return;

        appendMessage('You', message);
        userInput.value = '';

        chatAbortController = new AbortController();

        try {
            setSendState(true);
            const response = await fetch('/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message
                }),
                signal: chatAbortController.signal
            });
            const data = await response.json();
            appendMessage('AI', data.response, {
                showLlmButton: data.no_qna_match,
                question: data.last_question,
                noMatchMessage: data.no_qna_match_message
            });
            updateChatHistory(data.full_history, {
                showLlmButton: data.no_qna_match,
                question: data.last_question,
                noMatchMessage: data.no_qna_match_message
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                appendMessage('System', 'Generation stopped.');
            } else {
                console.error('Error:', error);
                appendMessage('System', 'An error occurred while processing your message.');
            }
        } finally {
            setSendState(false);
            chatAbortController = null;
        }
    });

    function showUploadConfirmation() {
        return new Promise((resolve) => {
            const confirmationDialog = document.createElement('div');
            confirmationDialog.innerHTML = `
                <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 9999;">
                    <div style="background: white; padding: 20px; border-radius: 5px; text-align: center; box-shadow: 0 16px 40px rgba(15,23,42,0.25);">
                        <p>You have an existing chat history. What would you like to do?</p>
                        <button id="clearChatBtn">Clear chat and upload</button>
                        <button id="keepChatBtn">Keep chat and upload</button>
                        <button id="cancelUploadBtn">Cancel upload</button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmationDialog);

            document.getElementById('clearChatBtn').onclick = () => {
                document.body.removeChild(confirmationDialog);
                resolve('clear');
            };
            document.getElementById('keepChatBtn').onclick = () => {
                document.body.removeChild(confirmationDialog);
                resolve('keep');
            };
            document.getElementById('cancelUploadBtn').onclick = () => {
                document.body.removeChild(confirmationDialog);
                resolve('cancel');
            };
        });
    }

    function appendMessage(sender, message, options = {}) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${sender.toLowerCase()}-message`;
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        if (sender === 'AI' && options.showLlmButton) {
            lastNoMatchQuestion = options.question || '';
            lastNoMatchMessage = options.noMatchMessage || message;
            const button = createLlmButton(lastNoMatchQuestion);
            messageElement.appendChild(button);
        }
        chatHistory.appendChild(messageElement);
        scrollToBottom();
    }

    function scrollToBottom() {
        if (chatHistory) {
            requestAnimationFrame(() => {
                chatHistory.scrollTop = chatHistory.scrollHeight;
            });
        }
    }

    function updateChatHistory(fullHistory, noMatchOptions = {}) {
        chatHistory.innerHTML = ''; // Clear existing chat history
        fullHistory.forEach(message => {
            if (message.startsWith('Human: ')) {
                appendMessage('You', message.substring(7));
            } else if (message.startsWith('AI: ')) {
                const aiText = message.substring(4);
                const showLlmButton =
                    noMatchOptions.showLlmButton &&
                    aiText === noMatchOptions.noMatchMessage;
                appendMessage('ML', aiText, {
                    showLlmButton: showLlmButton,
                    question: noMatchOptions.question,
                    noMatchMessage: noMatchOptions.noMatchMessage
                });
            } else if (message.startsWith('System: ')) {
                appendMessage('System', message.substring(8));
            }
        });
        scrollToBottom();
        saveChatHistory();
    }

    function createLlmButton(question) {
        const button = document.createElement('button');
        button.className = 'llm-fallback-button';
        button.type = 'button';
        button.textContent = 'Ask LLM for answer';
        button.addEventListener('click', async () => {
            if (!question) return;
            button.disabled = true;
            appendMessage('System', 'Trying LLM fallback...');
            try {
                setSpinner(true);
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: question,
                        force_llm: true
                    }),
                });
                const data = await response.json();
                appendMessage('AI', data.response);
                updateChatHistory(data.full_history);
            } catch (error) {
                console.error('Error:', error);
                appendMessage('System', 'LLM fallback failed.');
            } finally {
                setSpinner(false);
            }
        });
        return button;
    }

    function saveChatHistory() {
        localStorage.setItem('chatHistory', chatHistory.innerHTML);
    }

    function loadChatHistory() {
        const savedHistory = localStorage.getItem('chatHistory');
        if (savedHistory) {
            chatHistory.innerHTML = savedHistory;
            scrollToBottom();
        }
    }

    function loadFileContent() {
        const savedFileContent = localStorage.getItem('fileContent');
        if (savedFileContent) {
            fileContent.textContent = savedFileContent;
        }
    }

    async function clearChat() {
        try {
            setLoading(true);
            const response = await fetch('/clear_chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (data.status !== 'success') {
                throw new Error('Failed to clear chat history');
            }
            chatHistory.innerHTML = '';
            localStorage.removeItem('chatHistory');
        } catch (error) {
            console.error('Error clearing chat:', error);
            alert('An error occurred while clearing the chat. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    async function clearAll() {
        try {
            setLoading(true);
            const response = await fetch('/clear_all', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            });
            const data = await response.json();
            if (data.status !== 'success') {
                throw new Error('Failed to clear all data');
            }
            chatHistory.innerHTML = '';
            fileContent.textContent = '';
            localStorage.clear();
            // Force a hard reload of the page to clear any cached data
            window.location.reload(true);
        } catch (error) {
            console.error('Error clearing all data:', error);
            alert('An error occurred while clearing all data. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    exportChatButton.addEventListener('click', () => {
        const chatContent = chatHistory.innerText;
        const blob = new Blob([chatContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chat_export.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    clearChatButton.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear the chat history? This action cannot be undone.')) {
            await clearChat();
        }
    });

    clearAllButton.addEventListener('click', async () => {
        if (confirm('Are you sure you want to clear all data? This will remove the chat history and uploaded file content. This action cannot be undone.')) {
            await clearAll();
        }
    });

    clearSelectionButton.addEventListener('click', () => {
        selectedFiles = [];
        updateFileInputFromSelection();
        renderFileList();
    });

    updateUploadUi();
});