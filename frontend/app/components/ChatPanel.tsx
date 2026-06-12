type Message = {
  id: number;
  user_message: string;
  ai_response: string;
};

type Props = {
  message: string;
  setMessage: (value: string) => void;
  response: string;
  history: Message[];
  sendMessage: () => void;
};

export default function ChatPanel({
  message,
  setMessage,
  response,
  history,
  sendMessage,
}: Props) {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-4">Chat</h2>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="border p-2 w-full"
      />

      <button
        onClick={sendMessage}
        className="bg-black text-white px-4 py-2 mt-2 rounded"
      >
        Send
      </button>

      <div className="mt-4">
        <strong>Response:</strong>
        <p>{response}</p>
      </div>

      <div className="mt-6">
        <h3 className="font-bold">History</h3>

        {history.map((item) => (
          <div
            key={item.id}
            className="border p-2 my-2 rounded"
          >
            <p>
              <strong>You:</strong> {item.user_message}
            </p>

            <p>
              <strong>Oracle:</strong> {item.ai_response}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}