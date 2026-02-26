// src/pages/HybridSchedulerPage.jsx
import React, { useState, useEffect } from 'react';
import {
  runHybridScheduling,
  generateDraftSchedule,
  optimizeScheduleWithBackend,
  compareSchedules,
} from '../services/hybridScheduler';
import { getToken } from '../api/client';

export default function HybridSchedulerPage() {
  // Form state
  const [sectionId, setSectionId] = useState('CARDIYOLOJI');
  const [serviceId, setServiceId] = useState('');
  const [role, setRole] = useState('Hemşire');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [targetHours, setTargetHours] = useState(160);

  // Schedule state
  const [draft, setDraft] = useState(null);
  const [optimized, setOptimized] = useState(null);
  const [comparison, setComparison] = useState(null);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('draft'); // draft | optimized | comparison

  // Step tracking
  const [currentStep, setCurrentStep] = useState('input'); // input | draft | optimize | compare

  // Handlers
  const handleGenerateDraft = async () => {
    setError('');
    setLoading(true);
    setCurrentStep('draft');

    try {
      // TODO: Get rows and staffRaw from your data source
      // For now, using dummy data
      const result = await generateDraftSchedule({
        year,
        month0: month,
        role,
        rows: [],
        overrides: {},
        staffRaw: [],
      });

      setDraft(result);
      setActiveTab('draft');
    } catch (err) {
      setError(`Draft generation failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOptimize = async () => {
    if (!draft) {
      setError('Önce draft oluşturun');
      return;
    }

    setError('');
    setLoading(true);
    setCurrentStep('optimize');

    try {
      const token = getToken();
      if (!token) throw new Error('Token gerekli');

      const result = await optimizeScheduleWithBackend({
        sectionId,
        serviceId,
        role,
        year,
        month: month + 1,
        draftData: draft,
        targetHours,
        token,
      });

      setOptimized(result);
      setActiveTab('optimized');
    } catch (err) {
      setError(`Optimization failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = () => {
    if (!draft || !optimized) {
      setError('Draft ve Optimized schedule gerekli');
      return;
    }

    const comp = compareSchedules(draft, optimized);
    setComparison(comp);
    setActiveTab('comparison');
    setCurrentStep('compare');
  };

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white rounded-lg shadow">
      <h1 className="text-3xl font-bold mb-2">Hybrid Scheduler</h1>
      <p className="text-gray-600 mb-6">Frontend Draft + Backend Optimization</p>

      {/* Progress */}
      <div className="mb-6 flex gap-2">
        <div
          className={`px-4 py-2 rounded ${
            currentStep === 'input'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200'
          }`}
        >
          1. Input
        </div>
        <div
          className={`px-4 py-2 rounded ${
            currentStep === 'draft'
              ? 'bg-blue-600 text-white'
              : currentStep === 'input'
              ? 'bg-gray-200'
              : 'bg-green-600 text-white'
          }`}
        >
          2. Draft
        </div>
        <div
          className={`px-4 py-2 rounded ${
            currentStep === 'optimize'
              ? 'bg-blue-600 text-white'
              : currentStep === 'input' || currentStep === 'draft'
              ? 'bg-gray-200'
              : 'bg-green-600 text-white'
          }`}
        >
          3. Optimize
        </div>
        <div
          className={`px-4 py-2 rounded ${
            currentStep === 'compare'
              ? 'bg-blue-600 text-white'
              : currentStep === 'compare'
              ? 'bg-green-600 text-white'
              : 'bg-gray-200'
          }`}
        >
          4. Compare
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-md">
          {error}
        </div>
      )}

      {/* Input Section */}
      {currentStep === 'input' && (
        <div className="space-y-4 mb-6 p-4 bg-gray-50 rounded-lg">
          <h2 className="text-xl font-semibold">Planlama Parametreleri</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bölüm ID</label>
              <input
                type="text"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Servis ID</label>
              <input
                type="text"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Rol</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option>Hemşire</option>
                <option>Doktor</option>
                <option>Teknisyen</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Hedef Saat</label>
              <input
                type="number"
                value={targetHours}
                onChange={(e) => setTargetHours(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Yıl</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ay</label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Date(2000, i).toLocaleString('tr-TR', {
                      month: 'long',
                    })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerateDraft}
            disabled={loading}
            className="w-full px-6 py-3 bg-blue-600 text-white font-semibold rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Taslak Oluşturuluyor...' : 'Taslak Oluştur'}
          </button>
        </div>
      )}

      {/* Tabs */}
      {(draft || optimized) && (
        <div className="mb-6 border-b border-gray-200">
          <div className="flex gap-4">
            {draft && (
              <button
                onClick={() => setActiveTab('draft')}
                className={`px-4 py-2 font-semibold border-b-2 ${
                  activeTab === 'draft'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600'
                }`}
              >
                📋 Taslak
              </button>
            )}
            {optimized && (
              <button
                onClick={() => setActiveTab('optimized')}
                className={`px-4 py-2 font-semibold border-b-2 ${
                  activeTab === 'optimized'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600'
                }`}
              >
                ⚡ Optimize
              </button>
            )}
            {comparison && (
              <button
                onClick={() => setActiveTab('comparison')}
                className={`px-4 py-2 font-semibold border-b-2 ${
                  activeTab === 'comparison'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600'
                }`}
              >
                🔄 Karşılaştırma
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {activeTab === 'draft' && draft && (
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Frontend Taslak</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Stage: <span className="font-mono">{draft.stage}</span></div>
              <div>Timestamp: <span className="font-mono text-xs">{draft.timestamp}</span></div>
              <div>Staff: <span>{draft.metadata.staffCount}</span></div>
              <div>Rows: <span>{draft.metadata.rowsCount}</span></div>
            </div>
            <pre className="mt-4 p-2 bg-white rounded text-xs overflow-auto max-h-64">
              {JSON.stringify(draft.data, null, 2)}
            </pre>
          </div>

          <button
            onClick={handleOptimize}
            disabled={loading}
            className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Optimize Ediliyor...' : '⚡ Backend ile Optimize Et'}
          </button>
        </div>
      )}

      {activeTab === 'optimized' && optimized && (
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-2">Backend Optimize</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>Stage: <span className="font-mono">{optimized.stage}</span></div>
              <div>ID: <span className="font-mono text-xs">{optimized.generatedId}</span></div>
              <div>Issues: <span>{optimized.metadata.issues.length}</span></div>
            </div>

            {optimized.metadata.appliedRules && (
              <div className="mt-4">
                <h4 className="font-semibold mb-2">Uygulanan Kurallar:</h4>
                <pre className="p-2 bg-white rounded text-xs overflow-auto max-h-48">
                  {JSON.stringify(optimized.metadata.appliedRules, null, 2)}
                </pre>
              </div>
            )}

            <pre className="mt-4 p-2 bg-white rounded text-xs overflow-auto max-h-64">
              {JSON.stringify(optimized.data, null, 2)}
            </pre>
          </div>

          <button
            onClick={handleCompare}
            className="w-full px-6 py-3 bg-purple-600 text-white font-semibold rounded-md hover:bg-purple-700"
          >
            🔄 Karşılaştır
          </button>
        </div>
      )}

      {activeTab === 'comparison' && comparison && (
        <div className="space-y-4">
          <div className="p-4 bg-purple-50 rounded-lg">
            <h3 className="text-lg font-semibold mb-4">Sonuç Karşılaştırması</h3>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="p-3 bg-white rounded border-l-4 border-blue-600">
                <div className="text-sm text-gray-600">Taslak Atamaları</div>
                <div className="text-2xl font-bold">{comparison.draftAssignments}</div>
              </div>
              <div className="p-3 bg-white rounded border-l-4 border-green-600">
                <div className="text-sm text-gray-600">Optimize Atamaları</div>
                <div className="text-2xl font-bold">{comparison.optimizedAssignments}</div>
              </div>
              <div className="p-3 bg-white rounded border-l-4 border-orange-600">
                <div className="text-sm text-gray-600">Sorunlar</div>
                <div className="text-2xl font-bold">{comparison.issues.length}</div>
              </div>
            </div>

            {comparison.issues.length > 0 && (
              <div>
                <h4 className="font-semibold mb-2">Tespit Edilen Sorunlar:</h4>
                <ul className="space-y-2">
                  {comparison.issues.map((issue, idx) => (
                    <li key={idx} className="p-2 bg-orange-50 rounded text-sm">
                      <strong>Tarih:</strong> {issue.date} | <strong>Eksik:</strong> {issue.missing} |{' '}
                      <strong>Neden:</strong> {issue.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
