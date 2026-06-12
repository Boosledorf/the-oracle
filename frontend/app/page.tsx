"use client";

import { ChangeEvent, useEffect, useState } from "react";

type Message = {
  id: number;
  user_message: string;
  ai_response: string;
};

type Document = {
  id: number;
  filename: string;
  file_path: string;
  text_preview: string;
  total_characters: number;
};

type Assignment = {
  id: number;
  course: string;
  title: string;
  due_date: string;
  description: string;
  status: string;
};

type StudyPlan = {
  id: number;
  assignment_id: number;
  plan_text: string;
};

export default function Home() {
  const [activeTab, setActiveTab] = useState("chat");
  const [isUploadingPdf, setIsUploadingPdf] = useState(false);
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [history, setHistory] = useState<Message[]>([]);
  const [newCourse, setNewCourse] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingAssignmentId, setEditingAssignmentId] = useState<number | null>(null);
  const [editCourse, setEditCourse] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pdfPreview, setPdfPreview] = useState("");
  const [pdfName, setPdfName] = useState("");

  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [documentQuestion, setDocumentQuestion] = useState("");
  const [documentAnswer, setDocumentAnswer] = useState("");

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [studyPlans, setStudyPlans] = useState<StudyPlan[]>([]);


  async function loadHistory() {
    const res = await fetch("http://127.0.0.1:8000/history");
    const data = await res.json();
    setHistory(data);
  }

  async function loadDocuments() {
    const res = await fetch("http://127.0.0.1:8000/documents");
    const data = await res.json();
    setDocuments(data);
  }

  async function loadAssignments() {
    const res = await fetch("http://127.0.0.1:8000/assignments");
    const data = await res.json();
    setAssignments(data);
  }

  async function loadStudyPlans() {
    const res = await fetch("http://127.0.0.1:8000/study-plans");
    const data = await res.json();
    setStudyPlans(data);
  }

  async function sendMessage() {
    const res = await fetch("http://127.0.0.1:8000/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    const data = await res.json();
    setResponse(data.response);
    setMessage("");
    loadHistory();
  }

  async function uploadPdf() {
    if (!selectedFile) {
      alert("Please select a PDF first.");
      return;
    }

    setIsUploadingPdf(true);
    setPdfName("");
    setPdfPreview("");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await fetch("http://127.0.0.1:8000/upload-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      setPdfName(data.filename);
      setPdfPreview(data.text_preview);

      await analyzeDocument(data.id);
      await analyzeQuizzes(data.id);

      await loadDocuments();
      await loadAssignments();

      setActiveTab("assignments");
    } catch (error) {
      console.error(error);
      alert("Something went wrong while uploading or analyzing the PDF.");
    } finally {
      setIsUploadingPdf(false);
    }
  }

  async function askDocument() {
    if (!selectedDocumentId || !documentQuestion) return;

    const res = await fetch("http://127.0.0.1:8000/ask-document", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id: selectedDocumentId,
        question: documentQuestion,
      }),
    });

    const data = await res.json();
    setDocumentAnswer(`${data.answer}\n\n(Used Chunks: ${data.used_chunks})`);
  }

  async function updateAssignmentStatus(assignmentId: number, status: string) {
    await fetch("http://127.0.0.1:8000/update-assignment-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignment_id: assignmentId,
        status,
      }),
    });

    loadAssignments();
  }

  async function deleteAssignment(assignmentId: number) {
    const confirmed = window.confirm(
      "Delete this assignment?"
    );

    if (!confirmed) return;

    await fetch(
      "http://127.0.0.1:8000/delete-assignment",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assignment_id: assignmentId,
        }),
      }
    );

    loadAssignments();
  }

  async function createAssignment() {
    if (!newTitle.trim()) {
      alert("Assignment title is required.");
      return;
    }

    await fetch("http://127.0.0.1:8000/create-assignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        course: newCourse || "Unknown",
        title: newTitle,
        due_date: newDueDate || "Unknown",
        description: newDescription,
      }),
    });

    setNewCourse("");
    setNewTitle("");
    setNewDueDate("");
    setNewDescription("");

    loadAssignments();
  }

  function startEditingAssignment(assignment: Assignment) {
    setEditingAssignmentId(assignment.id);
    setEditCourse(assignment.course);
    setEditTitle(assignment.title);
    setEditDueDate(assignment.due_date);
    setEditDescription(assignment.description);
  }

  function cancelEditingAssignment() {
    setEditingAssignmentId(null);
    setEditCourse("");
    setEditTitle("");
    setEditDueDate("");
    setEditDescription("");
  }

  async function saveEditedAssignment() {
    if (!editingAssignmentId) return;

    await fetch("http://127.0.0.1:8000/update-assignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignment_id: editingAssignmentId,
        course: editCourse,
        title: editTitle,
        due_date: editDueDate,
        description: editDescription,
      }),
    });

    cancelEditingAssignment();
    loadAssignments();
  }

  async function analyzeDocument(documentId: number) {
    await fetch("http://127.0.0.1:8000/analyze-document", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id: documentId,
      }),
    });
  }

  async function analyzeQuizzes(documentId: number) {
    await fetch("http://127.0.0.1:8000/analyze-quizzes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        document_id: documentId,
      }),
    });
  }

  async function generateStudyPlan(assignmentId: number) {
    await fetch("http://127.0.0.1:8000/generate-study-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        assignment_id: assignmentId,
      }),
    });

    loadStudyPlans();
  }

  const assignmentsByCourse = assignments.reduce((groups, assignment) => {
    const course = assignment.course || "Unknown";

    if (!groups[course]) {
      groups[course] = [];
    }

    groups[course].push(assignment);

    return groups;
  }, {} as Record<string, Assignment[]>);

  const dueSoonAssignments = assignments.filter((assignment) => {
    return assignment.status !== "completed" && assignment.due_date !== "Unknown";
  });

  const assignmentsByDate = assignments.reduce((groups, assignment) => {
    const dueDate = assignment.due_date || "Unknown";

    if (!groups[dueDate]) {
      groups[dueDate] = [];
    }

    groups[dueDate].push(assignment);

    return groups;

  }, {} as Record<string, Assignment[]>);
  useEffect(() => {
    loadHistory();
    loadDocuments();
    loadAssignments();
    loadStudyPlans();
  }, []);
  const courseDashboard = Object.entries(assignmentsByCourse).map(
    ([course, courseAssignments]) => {
      const completed = courseAssignments.filter(
        (assignment) => assignment.status === "completed"
      ).length;

      const inProgress = courseAssignments.filter(
        (assignment) => assignment.status === "in progress"
      ).length;

      const notStarted = courseAssignments.filter(
        (assignment) => assignment.status === "not started"
      ).length;

      const nextDue = courseAssignments.find(
        (assignment) =>
          assignment.status !== "completed" &&
          assignment.due_date !== "Unknown"
      );

      return {
        course,
        total: courseAssignments.length,
        completed,
        inProgress,
        notStarted,
        nextDue,
      };
    }
  );
  const totalCourses = Object.keys(assignmentsByCourse).length;

  const totalAssignments = assignments.length;

  const completedAssignments = assignments.filter(
    (assignment) => assignment.status === "completed"
  ).length;

  const dueSoonCount = assignments.filter(
    (assignment) =>
      assignment.status !== "completed" &&
      assignment.due_date !== "Unknown"
  ).length;

  return (
    <main className="min-h-screen flex bg-gray-100">
      <aside className="w-64 bg-black text-white p-6">
        <h1 className="text-2xl font-bold mb-8">The Oracle</h1>

        {["chat", "documents", "history", "assignments", "calendar"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`block w-full text-left p-3 rounded capitalize ${activeTab === tab ? "bg-gray-800" : "hover:bg-gray-800"
              }`}
          >
            {tab}
          </button>
        ))}
      </aside>

      <section className="flex-1 p-8">
        {activeTab === "chat" && (
          <div>
            <h2 className="text-3xl font-bold mb-4">Chat</h2>

            <textarea
              className="border p-3 w-full h-32 bg-white rounded"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask your local AI something..."
            />

            <button
              onClick={sendMessage}
              className="bg-black text-white px-4 py-2 mt-3 rounded"
            >
              Send
            </button>

            {response && (
              <div className="mt-6 border p-4 bg-white rounded">
                <h3 className="font-bold mb-2">AI Response:</h3>
                <p className="whitespace-pre-wrap">{response}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "documents" && (
          <div>
            <h2 className="text-3xl font-bold mb-4">Documents</h2>

            <div className="border p-4 bg-white rounded mb-6">
              <h3 className="text-xl font-bold mb-4">Upload PDF</h3>

              <input
                type="file"
                accept="application/pdf"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  if (e.target.files && e.target.files.length > 0) {
                    setSelectedFile(e.target.files[0]);
                  }
                }}
              />

              <button
                onClick={uploadPdf}
                disabled={isUploadingPdf}
                className={`px-4 py-2 mt-3 block rounded text-white ${isUploadingPdf
                  ? "bg-gray-500 cursor-not-allowed"
                  : "bg-black hover:bg-gray-800"
                  }`}
              >
                {isUploadingPdf
                  ? "Oracle is analyzing PDF..."
                  : "Upload PDF"}
              </button>
              {isUploadingPdf && (
                <div className="mt-3 border p-3 rounded bg-yellow-50">
                  <p className="font-bold">
                    Oracle is processing your document...
                  </p>

                  <p className="text-sm mt-1">
                    Extracting text → Creating chunks →
                    Generating embeddings →
                    Finding assignments →
                    Building calendar entries
                  </p>
                </div>
              )}

              {pdfName && (
                <div className="mt-4">
                  <p className="font-bold">Uploaded:</p>
                  <p>{pdfName}</p>
                </div>
              )}

              {pdfPreview && (
                <div className="mt-4 border p-4 rounded">
                  <h4 className="font-bold mb-2">Text Preview:</h4>
                  <p className="whitespace-pre-wrap">{pdfPreview}</p>
                </div>
              )}
            </div>

            <div className="border p-4 bg-white rounded mb-6">
              <h3 className="text-xl font-bold mb-4">Ask a Document</h3>

              <select
                className="border p-2 w-full mb-3"
                value={selectedDocumentId ?? ""}
                onChange={(e) => setSelectedDocumentId(Number(e.target.value))}
              >
                <option value="">Choose a document</option>

                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.filename}
                  </option>
                ))}
              </select>

              <textarea
                className="border p-3 w-full h-24 rounded"
                value={documentQuestion}
                onChange={(e) => setDocumentQuestion(e.target.value)}
                placeholder="Ask a question about the selected document..."
              />

              <button
                onClick={askDocument}
                className="bg-black text-white px-4 py-2 mt-3 rounded"
              >
                Ask Document
              </button>

              {documentAnswer && (
                <div className="mt-4 border p-4 rounded">
                  <h4 className="font-bold mb-2">Answer:</h4>
                  <p className="whitespace-pre-wrap">{documentAnswer}</p>
                </div>
              )}
            </div>

            <div className="border p-4 bg-white rounded">
              <h3 className="text-xl font-bold mb-4">Uploaded Documents</h3>

              {documents.map((doc) => (
                <div key={doc.id} className="border p-4 mb-3 rounded">
                  <p className="font-bold">{doc.filename}</p>
                  <p>Characters: {doc.total_characters}</p>
                  <p className="mt-2 text-sm">
                    {doc.text_preview.substring(0, 250)}...
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div>
            <h2 className="text-3xl font-bold mb-4">Chat History</h2>

            {history.map((item) => (
              <div key={item.id} className="border p-4 mb-4 bg-white rounded">
                <p className="font-bold">You:</p>
                <p>{item.user_message}</p>

                <p className="font-bold mt-3">AI:</p>
                <p className="whitespace-pre-wrap">{item.ai_response}</p>
              </div>
            ))}
          </div>
        )}

        {activeTab === "assignments" && (
          <div>
            <h2 className="text-3xl font-bold mb-4">Assignments</h2>

            <button
              onClick={loadAssignments}
              className="bg-black text-white px-4 py-2 mb-4 rounded"
            >
              Refresh Assignments
            </button>
            <div className="border p-4 bg-white rounded mb-6">
              <h3 className="text-xl font-bold mb-3">Add Assignment</h3>

              <input
                className="border p-2 w-full mb-2 rounded"
                value={newCourse}
                onChange={(e) => setNewCourse(e.target.value)}
                placeholder="Course, e.g. Math 101"
              />

              <input
                className="border p-2 w-full mb-2 rounded"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Assignment title"
              />

              <input
                className="border p-2 w-full mb-2 rounded"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                placeholder="Due date, e.g. July 13"
              />

              <textarea
                className="border p-2 w-full mb-2 rounded"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Description"
              />

              <button
                onClick={createAssignment}
                className="bg-black text-white px-4 py-2 rounded"
              >
                Add Assignment
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white border rounded p-4">
                <p className="text-sm text-gray-500">Courses</p>
                <p className="text-3xl font-bold">
                  {totalCourses}
                </p>
              </div>

              <div className="bg-white border rounded p-4">
                <p className="text-sm text-gray-500">Assignments</p>
                <p className="text-3xl font-bold">
                  {totalAssignments}
                </p>
              </div>

              <div className="bg-white border rounded p-4">
                <p className="text-sm text-gray-500">Due Soon</p>
                <p className="text-3xl font-bold">
                  {dueSoonCount}
                </p>
              </div>

              <div className="bg-white border rounded p-4">
                <p className="text-sm text-gray-500">Completed</p>
                <p className="text-3xl font-bold">
                  {completedAssignments}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {courseDashboard.map((course) => (
                <div key={course.course} className="border p-4 bg-white rounded">
                  <h3 className="text-xl font-bold mb-2">{course.course}</h3>

                  <p>
                    <strong>Total:</strong> {course.total}
                  </p>

                  <p>
                    <strong>Completed:</strong> {course.completed}
                  </p>

                  <p>
                    <strong>In Progress:</strong> {course.inProgress}
                  </p>

                  <p>
                    <strong>Not Started:</strong> {course.notStarted}
                  </p>

                  <div className="mt-3 border-t pt-3">
                    <p className="font-bold">Next Due:</p>

                    {course.nextDue ? (
                      <p>
                        {course.nextDue.title} — {course.nextDue.due_date}
                      </p>
                    ) : (
                      <p>No upcoming assignments.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="border p-4 bg-white rounded mb-6">
              <h3 className="text-xl font-bold mb-3">Due Soon</h3>

              {dueSoonAssignments.length === 0 && (
                <p>No upcoming assignments found.</p>
              )}

              {dueSoonAssignments.map((assignment) => (
                <div key={assignment.id} className="border p-3 mb-3 rounded">
                  <p className="font-bold">{assignment.title}</p>
                  <p>
                    <strong>Course:</strong> {assignment.course}
                  </p>
                  <p>
                    <strong>Due:</strong> {assignment.due_date}
                  </p>
                  <p>
                    <strong>Status:</strong> {assignment.status}
                  </p>
                </div>
              ))}
            </div>

            {assignments.length === 0 && (
              <div className="border p-4 bg-white rounded">
                <p>No assignments saved yet.</p>
              </div>
            )}

            {Object.entries(assignmentsByCourse).map(([course, courseAssignments]) => (
              <details key={course} className="border bg-white rounded mb-4" open>
                <summary className="cursor-pointer p-4 text-xl font-bold bg-gray-100">
                  {course} ({courseAssignments.length})
                </summary>

                <div className="p-4">
                  {courseAssignments.map((assignment) => (
                    <div key={assignment.id} className="border p-4 mb-3 rounded">
                      <p className="text-lg font-bold">{assignment.title}</p>

                      <p className="mt-1">
                        <strong>Due:</strong> {assignment.due_date}
                      </p>

                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => updateAssignmentStatus(assignment.id, "not started")}
                          className={`px-3 py-1 rounded ${assignment.status === "not started"
                            ? "bg-red-500 text-white"
                            : "bg-gray-200"
                            }`}
                        >
                          Not Started
                        </button>

                        <button
                          onClick={() => updateAssignmentStatus(assignment.id, "in progress")}
                          className={`px-3 py-1 rounded ${assignment.status === "in progress"
                            ? "bg-yellow-500 text-white"
                            : "bg-gray-200"
                            }`}
                        >
                          In Progress
                        </button>

                        <button
                          onClick={() => updateAssignmentStatus(assignment.id, "completed")}
                          className={`px-3 py-1 rounded ${assignment.status === "completed"
                            ? "bg-green-500 text-white"
                            : "bg-gray-200"
                            }`}
                        >
                          Completed
                        </button>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => startEditingAssignment(assignment)}
                          className="px-3 py-1 rounded bg-blue-700 text-white"
                        >
                          Edit
                        </button>

                        <button
                          onClick={() => deleteAssignment(assignment.id)}
                          className="px-3 py-1 rounded bg-red-700 text-white"
                        >
                          Delete
                        </button>
                      </div>
                      {editingAssignmentId === assignment.id && (
                        <div className="mt-3 border p-3 rounded bg-blue-50">
                          <input
                            className="border p-2 w-full mb-2 rounded"
                            value={editCourse}
                            onChange={(e) => setEditCourse(e.target.value)}
                            placeholder="Course"
                          />

                          <input
                            className="border p-2 w-full mb-2 rounded"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Title"
                          />

                          <input
                            className="border p-2 w-full mb-2 rounded"
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            placeholder="Due date"
                          />

                          <textarea
                            className="border p-2 w-full mb-2 rounded"
                            value={editDescription}
                            onChange={(e) => setEditDescription(e.target.value)}
                            placeholder="Description"
                          />

                          <button
                            onClick={saveEditedAssignment}
                            className="bg-black text-white px-3 py-1 rounded mr-2"
                          >
                            Save
                          </button>

                          <button
                            onClick={cancelEditingAssignment}
                            className="bg-gray-300 px-3 py-1 rounded"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

                      <button
                        onClick={() => generateStudyPlan(assignment.id)}
                        className="bg-purple-700 text-white px-3 py-1 rounded mt-3"
                      >
                        Generate Study Plan
                      </button>

                      {studyPlans
                        .filter((plan) => plan.assignment_id === assignment.id)
                        .map((plan) => (
                          <div key={plan.id} className="mt-3 border p-3 rounded bg-gray-50">
                            <p className="font-bold mb-2">Study Plan</p>

                            <pre className="whitespace-pre-wrap text-sm">
                              {plan.plan_text}
                            </pre>
                          </div>
                        ))}

                      <p className="mt-2">{assignment.description}</p>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}

        {activeTab === "calendar" && (
          <div>
            <h2 className="text-3xl font-bold mb-4">Calendar</h2>

            <button
              onClick={loadAssignments}
              className="bg-black text-white px-4 py-2 mb-4 rounded"
            >
              Refresh Calendar
            </button>

            {assignments.length === 0 && (
              <div className="border p-4 bg-white rounded">
                <p>No assignments found.</p>
              </div>
            )}

            {Object.entries(assignmentsByDate).map(([dueDate, dateAssignments]) => (
              <div key={dueDate} className="border bg-white rounded mb-4">
                <div className="p-4 text-xl font-bold bg-gray-100">
                  {dueDate}
                </div>

                <div className="p-4">
                  {dateAssignments.map((assignment) => (
                    <div key={assignment.id} className="border p-4 mb-3 rounded">
                      <p className="text-lg font-bold">{assignment.title}</p>

                      <p>
                        <strong>Course:</strong> {assignment.course}
                      </p>

                      <p>
                        <strong>Status:</strong> {assignment.status}
                      </p>

                      <p className="mt-2">{assignment.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}