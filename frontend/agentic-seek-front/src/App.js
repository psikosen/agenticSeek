import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import axios from 'axios';
import './App.css';
import { colors } from './colors';

function App() {
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [currentView, setCurrentView] = useState('blocks');
    const [responseData, setResponseData] = useState(null);
    const [isOnline, setIsOnline] = useState(false);
    const [status, setStatus] = useState('Agents ready');
    const messagesEndRef = useRef(null);
    const [currentModel, setCurrentModel] = useState('');
    const [newModelInput, setNewModelInput] = useState('');

    useEffect(() => {
        fetchCurrentModel(); // Fetch model on initial load
        const intervalId = setInterval(() => {
            checkHealth();
            fetchLatestAnswer();
            fetchScreenshot();
        }, 3000);
        return () => clearInterval(intervalId);
    }, [messages]); // currentModel removed from dependencies to avoid loop, fetchCurrentModel is called once

    const fetchCurrentModel = async () => {
        try {
            const res = await axios.get('http://127.0.0.1:8000/model');
            if (res.data && res.data.model_name) {
                setCurrentModel(res.data.model_name);
                setNewModelInput(res.data.model_name); // Initialize input with current model
            }
        } catch (err) {
            console.error('Error fetching current model:', err);
            // Optionally set an error state here
        }
    };

    const handleUpdateModel = async () => {
        if (!newModelInput.trim()) {
            alert('Please enter a model name.');
            return;
        }
        try {
            await axios.post('http://127.0.0.1:8000/model', { model_name: newModelInput });
            setCurrentModel(newModelInput);
            alert('Model updated successfully!');
        } catch (err) {
            console.error('Error updating model:', err);
            alert('Failed to update model.');
            // Optionally set an error state here
        }
    };

    const checkHealth = async () => {
        try {
            await axios.get('http://127.0.0.1:8000/health');
            setIsOnline(true);
            console.log('System is online');
        } catch {
            setIsOnline(false);
            console.log('System is offline');
        }
    };

    const fetchScreenshot = async () => {
        try {
            const timestamp = new Date().getTime();
            const res = await axios.get(`http://127.0.0.1:8000/screenshots/updated_screen.png?timestamp=${timestamp}`, {
                responseType: 'blob'
            });
            console.log('Screenshot fetched successfully');
            const imageUrl = URL.createObjectURL(res.data);
            setResponseData((prev) => {
                if (prev?.screenshot && prev.screenshot !== 'placeholder.png') {
                    URL.revokeObjectURL(prev.screenshot);
                }
                return {
                    ...prev,
                    screenshot: imageUrl,
                    screenshotTimestamp: new Date().getTime()
                };
            });
        } catch (err) {
            console.error('Error fetching screenshot:', err);
            setResponseData((prev) => ({
                ...prev,
                screenshot: 'placeholder.png',
                screenshotTimestamp: new Date().getTime()
            }));
        }
    };

    const normalizeAnswer = (answer) => {
        return answer
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/[.,!?]/g, '')
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const fetchLatestAnswer = async () => {
        try {
            const res = await axios.get('http://127.0.0.1:8000/latest_answer');
            const data = res.data;

            updateData(data);
            if (!data.answer || data.answer.trim() === '') {
                return;
            }
            const normalizedNewAnswer = normalizeAnswer(data.answer);
            const answerExists = messages.some(
                (msg) => normalizeAnswer(msg.content) === normalizedNewAnswer
            );
            if (!answerExists) {
                setMessages((prev) => [
                    ...prev,
                    {
                        type: 'agent',
                        content: data.answer,
                        reasoning: data.reasoning,
                        agentName: data.agent_name,
                        status: data.status,
                        uid: data.uid,
                    },
                ]);
                setStatus(data.status);
                scrollToBottom();
            } else {
                console.log('Duplicate answer detected, skipping:', data.answer);
            }
        } catch (error) {
            console.error('Error fetching latest answer:', error);
        }
    };

    const updateData = (data) => {
        setResponseData((prev) => ({
            ...prev,
            blocks: data.blocks || prev.blocks || null,
            done: data.done,
            answer: data.answer,
            agent_name: data.agent_name,
            status: data.status,
            uid: data.uid,
        }));
    };

    const handleStop = async (e) => {
        e.preventDefault();
        checkHealth();
        setIsLoading(false);
        setError(null);
        try {
            const res = await axios.get('http://127.0.0.1:8000/stop');
            setStatus("Requesting stop...");
        } catch (err) {
            console.error('Error stopping the agent:', err);
        }
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        checkHealth();
        if (!query.trim()) {
            console.log('Empty query');
            return;
        }
        setMessages((prev) => [...prev, { type: 'user', content: query }]);
        setIsLoading(true);
        setError(null);

        try {
            console.log('Sending query:', query);
            setQuery('waiting for response...');
            const res = await axios.post('http://127.0.0.1:8000/query', {
                query,
                tts_enabled: false
            });
            setQuery('Enter your query...');
            console.log('Response:', res.data);
            const data = res.data;
            updateData(data);
        } catch (err) {
            console.error('Error:', err);
            setError('Failed to process query.');
            setMessages((prev) => [
                ...prev,
                { type: 'error', content: 'Error: Unable to get a response.' },
            ]);
        } finally {
            console.log('Query completed');
            setIsLoading(false);
            setQuery('');
        }
    };

    const handleGetScreenshot = async () => {
        try {
            setCurrentView('screenshot');
        } catch (err) {
            setError('Browser not in use');
        }
    };

    return (
        <div className="app">
            <header className="header">
                <h1>AgenticSeek</h1>
                <div className="model-config-section">
                    <input
                        type="text"
                        value={newModelInput}
                        onChange={(e) => setNewModelInput(e.target.value)}
                        placeholder="Enter Ollama model name"
                    />
                    <button onClick={handleUpdateModel}>Update Model</button>
                    {currentModel && <p className="current-model-display">Current Model: {currentModel}</p>}
                </div>
            </header>
            <main className="main">
                <div className="app-sections">


                    <div className="chat-section">
                        <h2>Chat Interface</h2>
                        <div className="messages">
                            {messages.length === 0 ? (
                                <p className="placeholder">No messages yet. Type below to start!</p>
                            ) : (
                                messages.map((msg, index) => (
                                    <div
                                        key={index}
                                        className={`message ${
                                            msg.type === 'user'
                                                ? 'user-message'
                                                : msg.type === 'agent'
                                                ? 'agent-message'
                                                : 'error-message'
                                        }`}
                                    >
                                        {msg.type === 'agent' && (
                                            <span className="agent-name">{msg.agentName}</span>
                                        )}
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                ))
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                        {isOnline && <div className="loading-animation">{status}</div>}
                        {!isLoading && !isOnline && <p className="loading-animation">System offline. Deploy backend first.</p>}
                        <form onSubmit={handleSubmit} className="input-form">
                            <input
                                type="text"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="Type your query..."
                                disabled={isLoading}
                            />
                            <button type="submit" disabled={isLoading}>
                                Send
                            </button>
                            <button onClick={handleStop}>
                                Stop
                            </button>
                        </form>
                    </div>

                    <div className="computer-section">
                        <h2>Computer View</h2>
                        <div className="view-selector">
                            <button
                                className={currentView === 'blocks' ? 'active' : ''}
                                onClick={() => setCurrentView('blocks')}
                            >
                                Editor View
                            </button>
                            <button
                                className={currentView === 'screenshot' ? 'active' : ''}
                                onClick={responseData?.screenshot ? () => setCurrentView('screenshot') : handleGetScreenshot}
                            >
                                Browser View
                            </button>
                            <button
                                className={currentView === 'thinking' ? 'active' : ''}
                                onClick={() => setCurrentView('thinking')}
                            >
                                Reasoning view
                            </button>
                        </div>
                        <div className="content">
                            {error && <p className="error">{error}</p>}
                            {currentView === 'blocks' ? (
                                <div className="blocks">
                                    {responseData && responseData.blocks && Object.values(responseData.blocks).length > 0 ? (
                                        Object.values(responseData.blocks).map((block, index) => (
                                            <div key={index} className="block">
                                                <p className="block-tool">Tool: {block.tool_type}</p>
                                                <pre>{block.block}</pre>
                                                <p className="block-feedback">Feedback: {block.feedback}</p>
                                                {block.success ? (
                                                    <p className="block-success">Success</p>
                                                ) : (
                                                    <p className="block-failure">Failure</p>
                                                )}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="block">
                                            <p className="block-tool">Tool: No tool in use</p>
                                            <pre>No file opened</pre>
                                        </div>
                                    )}
                                </div>
                            ) : currentView == 'thinking' ? (
                                <div className="thinking">
                                    <div className="messages">
                                        {messages.length === 0 ? (
                                            <p className="placeholder">No thinking yet.</p>
                                        ) : (
                                            messages.map((msg, index) => (
                                                <div
                                                    key={index}
                                                    className={`message ${
                                                        msg.type === 'user'
                                                            ? 'user-message'
                                                            : msg.type === 'agent'
                                                            ? 'agent-message'
                                                            : 'error-message'
                                                    }`}
                                                >
                                                    {msg.type === 'agent' && (
                                                        <span className="agent-name">{msg.agentName}</span>
                                                    )}
                                                    <ReactMarkdown>{msg.reasoning}</ReactMarkdown>
                                                </div>
                                            ))
                                        )}
                                <div ref={messagesEndRef} />
                        </div>
                                </div>
                            ) : (
                                <div className="screenshot">
                                    <img
                                        src={responseData?.screenshot || 'placeholder.png'}
                                        alt="Screenshot"
                                        onError={(e) => {
                                            e.target.src = 'placeholder.png';
                                            console.error('Failed to load screenshot');
                                        }}
                                        key={responseData?.screenshotTimestamp || 'default'}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default App;
