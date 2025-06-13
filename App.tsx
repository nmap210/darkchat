
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { KeyDisplay } from './components/KeyDisplay';
import { ChatBox } from './components/ChatBox';
import { MessageInput } from './components/MessageInput';
import { DonationInfo } from './components/DonationInfo';
import * as cryptoService from './services/cryptoService';
import * as apiService from './services/apiService';
import { ChatMessageItem, MessageType, CryptoKeyPairParts } from './types';
import { POLLING_INTERVAL, API_URL } from './constants';

const App: React.FC = () => {
  const [keyPair, setKeyPair] = useState<CryptoKeyPair | null>(null);
  const [publicKeyB64, setPublicKeyB64] = useState<string>('');
  const [username, setUsername] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Ref to ensure polling doesn't start until keys are ready
  const keysInitialized = useRef(false);

  const addMessage = useCallback((text: string, type: MessageType) => {
    setMessages(prevMessages => [
      ...prevMessages,
      { id: crypto.randomUUID(), text, type, timestamp: Date.now() },
    ]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setMessages(prevMessages => prevMessages.filter(msg => msg.id !== id));
  }, []);

  useEffect(() => {
    const initializeKeys = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const storage = window.sessionStorage;
        let loadedKeyPair: CryptoKeyPair | null = null;
        const storedKeyPairJSON = storage.getItem('cryptoKeyPair');

        if (storedKeyPairJSON) {
          try {
            const storedKeys: CryptoKeyPairParts = JSON.parse(storedKeyPairJSON);
            const pubKey = await cryptoService.importPublicKey(storedKeys.publicKeyB64);
            const privKey = await cryptoService.importPrivateKeyPKCS8(storedKeys.privateKeyB64);
            loadedKeyPair = { publicKey: pubKey, privateKey: privKey };
          } catch (e) {
            console.warn("Failed to load stored keys, generating new ones.", e);
            storage.removeItem('cryptoKeyPair'); // Clear corrupted keys
          }
        }

        if (!loadedKeyPair) {
          loadedKeyPair = await cryptoService.generateKeys();
          const exportedPublicKeyB64 = await cryptoService.exportPublicKey(loadedKeyPair.publicKey);
          const exportedPrivateKeyB64 = await cryptoService.exportPrivateKey(loadedKeyPair.privateKey);
          storage.setItem('cryptoKeyPair', JSON.stringify({
            publicKeyB64: exportedPublicKeyB64,
            privateKeyB64: exportedPrivateKeyB64
          }));
        }
        
        setKeyPair(loadedKeyPair);
        const currentPublicKeyB64 = await cryptoService.exportPublicKey(loadedKeyPair.publicKey);
        setPublicKeyB64(currentPublicKeyB64);
        setUsername(`User-${currentPublicKeyB64.substring(0, 8)}`);
        addMessage("System initialized. Your keys are generated for this session. Share your Public Key to start.", MessageType.SYSTEM);
        keysInitialized.current = true;
      } catch (err) {
        console.error("Initialization Error:", err);
        setError("Failed to initialize cryptographic keys. Please refresh.");
        addMessage("CRITICAL ERROR: Could not initialize cryptography. Refresh page.", MessageType.ERROR);
      } finally {
        setIsLoading(false);
      }
    };
    initializeKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addMessage]); // addMessage is stable due to useCallback

  const checkForNewMessages = useCallback(async () => {
    if (!keyPair || !publicKeyB64 || !keysInitialized.current) return;

    try {
      const encryptedMessages = await apiService.receiveMessages(API_URL, publicKeyB64);
      if (encryptedMessages && encryptedMessages.length > 0) {
        for (const encryptedMsgB64 of encryptedMessages) {
          try {
            const decryptedText = await cryptoService.decryptMessage(encryptedMsgB64, keyPair.privateKey);
            // Avoid adding duplicate messages if by some chance polling is faster than state update
            // This is a simple check; more robust would be checking IDs if server provided them
            if (!messages.find(m => m.text === decryptedText && m.type === MessageType.RECEIVED)) {
                 addMessage(decryptedText, MessageType.RECEIVED);
            }
          } catch (decryptionError) {
            console.error("Decryption failed:", decryptionError);
            addMessage("Received a message that could not be decrypted.", MessageType.ERROR);
          }
        }
      }
    } catch (err) {
      console.log("Server unreachable or error fetching messages, will try again.", err);
      // Optionally add a system message for server errors, but original just logged.
    }
  }, [keyPair, publicKeyB64, addMessage, messages]);

  useEffect(() => {
    if (!keysInitialized.current || isLoading) return; // Don't start polling until keys are ready and not loading

    const intervalId = setInterval(checkForNewMessages, POLLING_INTERVAL);
    return () => clearInterval(intervalId);
  }, [checkForNewMessages, isLoading]);


  const handleSendMessage = async (recipientKeyB64: string, messageText: string) => {
    if (!keyPair || !publicKeyB64) {
      setError("Keys not available. Cannot send message.");
      addMessage("ERROR: Keys not available. Cannot send message.", MessageType.ERROR);
      return;
    }
    if (!recipientKeyB64.trim() || !messageText.trim()) {
      addMessage("Recipient public key and message cannot be empty.", MessageType.ERROR);
      return;
    }

    try {
      // 1. Encrypt for the actual recipient
      const recipientPublicKey = await cryptoService.importPublicKey(recipientKeyB64);
      const encryptedMessageForRecipient = await cryptoService.encryptMessage(messageText, recipientPublicKey);
      
      // 2. Send to the actual recipient's backend mailbox
      await apiService.sendMessage(API_URL, recipientKeyB64, encryptedMessageForRecipient);
      
      // 3. Display locally as 'sent' immediately
      addMessage(messageText, MessageType.SENT);

      // 4. Encrypt for self (to see in own inbox if polling, as per original spec)
      const encryptedMessageForSelf = await cryptoService.encryptMessage(messageText, keyPair.publicKey);
      
      // 5. Send to self's backend mailbox
      await apiService.sendMessage(API_URL, publicKeyB64, encryptedMessageForSelf);

    } catch (err) {
      console.error('Send Error:', err);
      let userErrorMessage = 'Failed to send message. Ensure recipient key is valid and server is reachable.';
      if (err instanceof Error && err.message.toLowerCase().includes("invalid key")) {
        userErrorMessage = 'Failed to send message. The recipient public key is invalid or in the wrong format.';
      }
      setError(userErrorMessage);
      addMessage(userErrorMessage, MessageType.ERROR);
    }
  };

  if (isLoading && !publicKeyB64) {
    return <div className="flex justify-center items-center h-screen bg-[#111] text-[#0f0] text-xl">Initializing Secure Session...</div>;
  }
  
  if (error && !publicKeyB64) {
     return <div className="flex justify-center items-center h-screen bg-[#111] text-red-500 p-4 text-center text-xl">{error}</div>;
  }

  return (
    <div className="font-mono bg-[#111] text-[#0f0] mx-auto max-w-3xl p-5 min-h-screen flex flex-col">
      <header className="mb-5">
        <h1 className="text-3xl font-bold text-center text-[#0f0] mb-1">Dark Web Messenger</h1>
        <h3 className="text-lg text-center text-[#0f0] mb-5">Principle: The server learns nothing.</h3>
        {publicKeyB64 && <KeyDisplay username={username} publicKeyB64={publicKeyB64} />}
        {error && <div className="bg-red-900 border border-red-500 text-red-300 p-3 my-3 rounded break-words">{error}</div>}
      </header>
      
      <main className="flex-grow flex flex-col">
        <ChatBox messages={messages} onRemoveMessage={removeMessage} />
        <MessageInput onSendMessage={handleSendMessage} />
      </main>
      
      <footer className="mt-auto pt-5">
        <DonationInfo />
      </footer>
    </div>
  );
};

export default App;
