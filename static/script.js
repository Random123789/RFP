document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const chatHistory = document.getElementById('chatHistory');
    const exportChatButton = document.getElementById('exportChat');
    const clearChatButton = document.getElementById('clearChat');
    const clearAllButton = document.getElementById('clearAll');
    const spinner = document.getElementById('spinner');
    const autocompleteContainer = document.getElementById('autocompleteContainer');
    const autocompleteList = document.getElementById('autocompleteList');
    const sendButton = chatForm.querySelector('button[type="submit"]');
    
    let lastNoMatchQuestion = '';
    let lastNoMatchMessage = '';
    let isGenerating = false;
    let chatAbortController = null;
    let debounceTimer = null;
    let selectedSuggestionIndex = -1;

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
        if (sender === 'You' || sender === 'AI' || sender === 'ML') {
            scrollToLatestUserMessage();
        } else {
            scrollToBottom();
        }
    }

    function scrollToLatestUserMessage() {
        if (!chatHistory) {
            return;
        }

        const userMessages = chatHistory.querySelectorAll('.you-message');
        if (userMessages.length === 0) {
            scrollToBottom();
            return;
        }

        const latestUserMessage = userMessages[userMessages.length - 1];
        requestAnimationFrame(() => {
            latestUserMessage.scrollIntoView({ block: 'start' });
        });
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
        scrollToLatestUserMessage();
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
            scrollToLatestUserMessage();
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

    // Scroll to top after everything is loaded
    window.scrollTo(0, 0);

});