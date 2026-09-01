import { useState, useRef, useCallback, useEffect } from "react";


interface Bill {
  id: string;
  name: string;
  pages: number;
  downloadUrl: string;
  previewUrl: string;
  pageInfo: string;
}

interface JobResult {
  jobId: string;
  totalPages: number;
  totalBills: number;
  splitMode: string;
  bills: Bill[];
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<JobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ src: string; name: string } | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [showContacts, setShowContacts] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load contacts on mount
  useEffect(() => {
    fetch("/api/contacts")
      .then((r) => r.json())
      .then(setContacts)
      .catch(() => {});
  }, []);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === "application/pdf") {
        setFile(droppedFile);
        setError(null);
      } else {
        setError("Only PDF files are allowed");
      }
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("pdf", file);
    formData.append("splitMode", "auto-detect");

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data: JobResult = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadAll = () => {
    if (result?.jobId) {
      window.open(`/api/download-all/${result.jobId}`, "_blank");
    }
  };

  // ── WhatsApp share ──
  const handleSendWhatsApp = async (bill: Bill) => {
    const phone = contacts[bill.name];
    if (!phone) {
      setShareStatus(`⚠️ No phone number saved for "${bill.name}". Click "Contacts" to add one.`);
      setTimeout(() => setShareStatus(null), 4000);
      return;
    }

    // Clean phone: remove +, spaces, dashes
    const cleanPhone = phone.replace(/[^0-9]/g, "");
    const message = encodeURIComponent(`Bill for ${bill.name}`);

    // Try Web Share API first (works great on mobile)
    if (navigator.share) {
      try {
        setShareStatus("Loading image...");
        const res = await fetch(bill.previewUrl);
        const blob = await res.blob();
        const file = new File([blob], `${bill.name}.png`, { type: "image/png" });

        await navigator.share({
          title: `Bill - ${bill.name}`,
          text: `Bill for ${bill.name}`,
          files: [file],
        });
        setShareStatus(null);
        return;
      } catch (err: any) {
        if (err.name === "AbortError") {
          setShareStatus(null);
          return; // User cancelled
        }
        // Fall through to wa.me link
      }
    }

    // Fallback: open WhatsApp with number + text (user attaches image manually)
    setShareStatus(`Opening WhatsApp for ${bill.name}... Download the image first, then attach it.`);
    setTimeout(() => setShareStatus(null), 5000);
    window.open(`https://wa.me/${cleanPhone}?text=${message}`, "_blank");
  };

  // ── Save contact ──
  const handleSaveContact = async () => {
    if (!newContactName || !newContactPhone) return;
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newContactName, phone: newContactPhone }),
    });
    const data = await res.json();
    setContacts(data.contacts);
    setNewContactName("");
    setNewContactPhone("");
  };

  // ── Edit contact ──
  const handleEditContact = async () => {
    if (!editingContact || !editName || !editPhone) return;
    const res = await fetch(`/api/contacts/${encodeURIComponent(editingContact)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName, phone: editPhone }),
    });
    const data = await res.json();
    setContacts(data.contacts);
    setEditingContact(null);
    setEditName("");
    setEditPhone("");
  };

  // ── Delete contact ──
  const handleDeleteContact = async (name: string) => {
    const res = await fetch(`/api/contacts/${encodeURIComponent(name)}`, { method: "DELETE" });
    const data = await res.json();
    setContacts(data.contacts);
  };

  const handleReset = () => {
    if (result?.jobId) {
      fetch(`/api/jobs/${result.jobId}`, { method: "DELETE" }).catch(() => {});
    }
    setFile(null);
    setResult(null);
    setError(null);
    setSearchQuery("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const filteredBills = result?.bills.filter(
    (bill) =>
      bill.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Billz - Bill Splitter</h1>
            <p className="text-sm text-gray-500">Separate combined PDF bills instantly</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Upload Section */}
        {!result && (
          <div className="space-y-6">
            {/* Drop zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                dragActive
                  ? "border-blue-500 bg-blue-50"
                  : file
                  ? "border-green-400 bg-green-50"
                  : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="space-y-2">
                  <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium text-gray-900">{file.name}</p>
                  <p className="text-sm text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB — Click to change
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-16 h-16 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                    <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <p className="text-lg font-medium text-gray-900">
                    Drop your combined PDF here
                  </p>
                  <p className="text-sm text-gray-500">
                    or click to browse — PDF files up to 50MB
                  </p>
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Split PDF into Bills
                </>
              )}
            </button>
          </div>
        )}

        {/* Results Section */}
        {result && (
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="bg-white rounded-2xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Bills Ready!</h2>
                  <p className="text-sm text-gray-500">
                    {result.totalBills} bills extracted from {result.totalPages} pages
                    {result.splitMode === "auto-detect" && (
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Auto-Detected
                      </span>
                    )}
                  </p>
                </div>
                <button
                  onClick={handleReset}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  Start Over
                </button>
              </div>

              {/* Search */}
              <div className="mb-4">
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search bills by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
              </div>

              {/* Share status message */}
              {shareStatus && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-sm mb-4">
                  {shareStatus}
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={handleDownloadAll}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-5 rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download All ({result.totalBills} bills)
                </button>
                <button
                  onClick={() => setShowContacts(!showContacts)}
                  className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2.5 px-5 rounded-xl transition-colors flex items-center gap-2 text-sm"
                >
                  📱 Contacts
                </button>
                <span className="text-sm text-gray-400 self-center">
                  {filteredBills.length} of {result.bills.length} shown
                </span>
              </div>
            </div>

            {/* Bills Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredBills.map((bill) => (
                <div
                  key={bill.id}
                  className="bg-white rounded-xl border shadow-sm p-4 hover:shadow-md transition-shadow"
                >
                  {/* Preview Image */}
                  <div
                    className="w-full h-40 bg-gray-50 rounded-lg overflow-hidden mb-3 border cursor-pointer hover:ring-2 hover:ring-blue-400 transition-all"
                    onClick={() => setSelectedImage({ src: bill.previewUrl, name: bill.name })}
                  >
                    <img
                      src={bill.previewUrl}
                      alt={bill.name}
                      className="w-full h-full object-contain object-top pointer-events-none"
                      onError={(e) => {
                        // Fallback to PDF icon if image fails to load
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent && !parent.querySelector('.fallback-icon')) {
                          const div = document.createElement('div');
                          div.className = 'fallback-icon w-full h-full flex items-center justify-center';
                          div.innerHTML = '<svg class="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>';
                          parent.appendChild(div);
                        }
                      }}
                    />
                  </div>

                  <h3 className="font-semibold text-gray-900 text-sm leading-tight">{bill.name}</h3>
                  <p className="text-xs text-gray-500 mt-1 mb-3">
                    {bill.pageInfo}
                  </p>

                  <div className="flex gap-2">
                    <a
                      href={bill.previewUrl}
                      download={`${bill.name}.png`}
                      className="flex-1 text-center bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium py-2 px-4 rounded-lg transition-colors text-sm"
                    >
                      Download
                    </a>
                    <button
                      onClick={() => handleSendWhatsApp(bill)}
                      className="flex-1 bg-green-500 hover:bg-green-600 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm flex items-center justify-center gap-1"
                    >
                      📱 Send
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {filteredBills.length === 0 && searchQuery && (
              <div className="text-center py-12 text-gray-500">
                <p>No bills match "{searchQuery}"</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Fullscreen Image Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          {/* Close button */}
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* Image name */}
          <div className="absolute top-4 left-4 text-white text-sm font-medium bg-black/50 px-3 py-1.5 rounded-lg z-10">
            {selectedImage.name}
          </div>

          {/* Image container */}
          <img
            src={selectedImage.src}
            alt={selectedImage.name}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Download button */}
          <a
            href={selectedImage.src}
            download={`${selectedImage.name}.png`}
            className="absolute bottom-4 right-4 bg-white hover:bg-gray-100 text-gray-900 font-medium py-2 px-4 rounded-lg shadow-lg flex items-center gap-2 text-sm z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </a>
        </div>
      )}

      {/* Contacts Panel */}
      {showContacts && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowContacts(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">📱 WhatsApp Contacts <span className="text-sm font-normal text-gray-400">({Object.entries(contacts).filter(([name, phone]) => name.toLowerCase().includes(contactSearch.toLowerCase()) || phone.toLowerCase().includes(contactSearch.toLowerCase())).length}{contactSearch ? ` of ${Object.keys(contacts).length}` : ''})</span></h3>
              <button onClick={() => setShowContacts(false)} className="text-gray-400 hover:text-gray-600">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              Map pharmacy names (from the bill) to their WhatsApp numbers.
            </p>

            {/* Search contacts */}
            <div className="relative mb-4">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search contacts..."
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>

            {/* Add new contact */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Pharmacy name"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="tel"
                placeholder="Phone number"
                value={newContactPhone}
                onChange={(e) => setNewContactPhone(e.target.value)}
                maxLength={10}
                className="w-36 border rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={handleSaveContact}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Add
              </button>
            </div>

            {/* Contact list */}
            <div className="space-y-2">
              {Object.entries(contacts)
                .filter(([name, phone]) =>
                  name.toLowerCase().includes(contactSearch.toLowerCase()) ||
                  phone.toLowerCase().includes(contactSearch.toLowerCase())
                )
                .map(([name, phone]) => (
                <div key={name} className="bg-gray-50 rounded-lg p-3">
                  {editingContact === name ? (
                    /* Edit mode */
                    <div className="flex flex-col gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="border rounded-lg px-3 py-1.5 text-sm"
                        placeholder="Pharmacy name"
                      />
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        maxLength={10}
                        className="border rounded-lg px-3 py-1.5 text-sm"
                        placeholder="Phone number"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleEditContact}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingContact(null)}
                          className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{name}</p>
                        <p className="text-xs text-gray-500">{phone}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setEditingContact(name);
                            setEditName(name);
                            setEditPhone(phone);
                          }}
                          className="text-blue-400 hover:text-blue-600 text-sm"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteContact(name)}
                          className="text-red-400 hover:text-red-600 text-sm"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {Object.keys(contacts).length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">
                  No contacts yet. Add pharmacies above.
                </p>
              )}
              {Object.keys(contacts).length > 0 && Object.entries(contacts).filter(([name, phone]) =>
                name.toLowerCase().includes(contactSearch.toLowerCase()) ||
                phone.toLowerCase().includes(contactSearch.toLowerCase())
              ).length === 0 && (
                <p className="text-center text-gray-400 text-sm py-4">
                  No contacts match "{contactSearch}"
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center py-6 text-sm text-gray-400">
        Made by Rafan❤️
      </footer>
    </div>
  );
}
