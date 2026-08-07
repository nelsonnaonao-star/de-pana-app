import React from "react";
import {
  Plus, Play, Camera, ChevronLeft, Send, X, Flame, Sparkles,
  Smile, Layout, Check, Heart, MessageCircle, Clock, Eye, Trash2,
  Video, Upload, Award, Info, User
} from "lucide-react";
import { Chat, Message } from "../types";
import MediaEditor from "./MediaEditor";
import CachedImage from "./CachedImage";
import { useSupabase } from "../contexts/SupabaseContext";
import toast from "react-hot-toast";
import { useStatesManagement, Story, UserState } from "../hooks/useStatesManagement";
import StoryViewer from "./states/StoryViewer";
import StateViewersModal from "./states/StateViewersModal";
import CreateStateModal from "./states/CreateStateModal";
import StoryAudiencePicker from "./states/StoryAudiencePicker";

interface StatesPanelProps {
  onStartChat: (name: string, avatar: string, initialText: string) => void;
  onHasUnseen?: (unseen: boolean) => void;
}

export default function StatesPanel({ onStartChat, onHasUnseen }: StatesPanelProps) {
  const { user, profile, contacts } = useSupabase();

  const {
    userStates, myStories, subView,
    uploadedMedia, showPublishDecisionModal, isEditingProState, publishStep, publishComment,
    activeUserStates, activeStoryIdx, storyProgress, storyReplyText,
    isStoryPaused, setStoryPaused,
    viewersData, showViewersSheet, myCurrentReaction, reactionFeedback,
    newTextContent, selectedGradientIdx, newImageCaption, selectedImageUrl,
    myUserStateRepresentation, GRADIENTS,
    setSubView, setPublishComment, setShowViewersSheet,
    setNewTextContent, setSelectedGradientIdx, setNewImageCaption, setSelectedImageUrl, setStoryReplyText,
    handleOpenStoryViewer, handleCloseStoryViewer, handleStoryTap, handleSendReply,
    handlePublishText, handlePublishImage, handleFileUploaded,
    handlePublishOriginal, handlePublishNow, handleGoToProEditor, handlePublishProState,
    handleDeleteMyStory, handleToggleReaction,
    setPublishStep, setIsEditingProState, setShowPublishDecisionModal,
    audience, handleSetAudience,
  } = useStatesManagement({
    userId: user?.id || "",
    profileName: profile?.name,
    profileAvatar: profile?.avatar || profile?.avatar_url,
    defaultAudience: profile?.default_story_audience,
    onStartChat,
    onHasUnseen,
  });

  const [showCreateMenu, setShowCreateMenu] = React.useState(false);

  const openStateMediaUpload = () => {
    const el = document.getElementById("state-media-upload-input");
    if (el) el.click();
    setShowCreateMenu(false);
  };

  const openTextCreator = () => {
    setShowCreateMenu(false);
    setSubView("create_text");
  };

  return (
    <div className="flex-1 bg-slate-50 flex flex-col h-full overflow-hidden select-none">

      <div className="bg-[#0a4d52] text-white px-3 pt-3 pb-2 shrink-0 flex flex-col gap-1.5 relative z-10 shadow-sm text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-teal-300" />
            <h3 className="text-xs font-black tracking-tight">Estados de Red On</h3>
          </div>
          <span className="text-[8px] bg-teal-400 text-white font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
            Momentáneos (24h)
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-left">

        <input
          id="state-media-upload-input"
          type="file"
          accept="image/*,video/*"
          onChange={handleFileUploaded}
          className="hidden"
        />

        {subView === "list" && (
          <div className="space-y-4 animate-fade-in">

            <div className="flex overflow-x-auto items-start gap-4 py-3 px-1 scrollbar-none">
              <div
                onClick={() => myStories.length > 0 && handleOpenStoryViewer(myUserStateRepresentation)}
                className="flex flex-col items-center gap-1 min-w-[70px] cursor-pointer"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-50 object-cover overflow-hidden">
                    {myStories.length > 0 ? (
                      <CachedImage
                        src={myUserStateRepresentation.userAvatar}
                        alt="Mi estado"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-slate-200 flex items-center justify-center">
                        <User className="w-6 h-6 text-slate-400" />
                      </div>
                    )}
                  </div>
                </div>
                <span className="text-[10px] font-medium text-gray-700 text-center truncate w-full">
                  Mi estado
                </span>
              </div>

              {userStates.map((userState) => (
                <div
                  key={userState.id}
                  onClick={() => handleOpenStoryViewer(userState)}
                  className="flex flex-col items-center gap-1 min-w-[70px] cursor-pointer"
                >
                  <div className="relative">
                    <CachedImage
                      src={userState.userAvatar}
                      alt={userState.userName}
                      className={`w-16 h-16 rounded-full object-cover ${
                        userState.hasUnseen
                          ? "ring-2 ring-emerald-500 ring-offset-2 ring-offset-slate-50"
                          : "ring-1 ring-slate-300 ring-offset-1 ring-offset-slate-50"
                      }`}
                    />
                  </div>
                  <span className="text-[10px] font-medium text-gray-700 text-center truncate w-full">
                    {userState.userName}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col items-center justify-center mt-10">
            <button
              onClick={() => setShowCreateMenu(true)}
              className="w-16 h-16 bg-emerald-600 text-white rounded-2xl shadow-lg flex flex-col items-center justify-center hover:bg-emerald-500 transition-transform active:scale-95 transition-all cursor-pointer"
            >
              <Plus className="w-8 h-8" />
            </button>
            <span className="text-sm font-medium text-slate-500 mt-3">Crear Estado</span>
          </div>

          <div className="bg-teal-50/50 rounded-xl p-3 border border-teal-100 flex gap-2 items-start">
              <Info className="w-4 h-4 text-[#10646a] shrink-0 mt-0.5" />
              <p className="text-[8.5px] text-slate-500 leading-relaxed">
                Los estados de Red On desaparecen automáticamente cada 24 horas. ¡El diseño es dinámico y soporta respuestas directas al chat privado del publicador!
              </p>
            </div>

          </div>
        )}

        {subView === "create_text" && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSubView("list")}
                className="text-[9px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-0.5 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Volver
              </button>
              <h4 className="text-[10px] font-black uppercase text-slate-400">Crear Estado de Texto</h4>
            </div>

            <div className={`aspect-[9/16] max-h-[300px] w-full rounded-2xl bg-gradient-to-br ${GRADIENTS[selectedGradientIdx]} flex flex-col justify-between p-5 text-white shadow-lg relative overflow-hidden`}>
              <div className="flex justify-between items-center z-10">
                <span className="text-[8px] font-bold tracking-widest uppercase bg-white/20 border border-white/10 px-2 py-0.5 rounded-full">
                  Editor Texto Red On
                </span>
                <button
                  onClick={() => setSelectedGradientIdx((prev) => (prev + 1) % GRADIENTS.length)}
                  className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer"
                  title="Cambiar Color de Fondo"
                >
                  <Smile className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 flex items-center justify-center py-4 z-10">
                <textarea
                  required
                  placeholder="¿En qué estás pensando hoy? Escribe algo increíble..."
                  value={newTextContent}
                  onChange={(e) => setNewTextContent(e.target.value)}
                  maxLength={160}
                  rows={4}
                  className="w-full text-center bg-transparent border-none text-xs font-extrabold text-white placeholder-white/60 resize-none outline-none focus:ring-0 leading-relaxed max-w-[180px]"
                />
              </div>

              <div className="text-center text-[7.5px] opacity-75 font-mono z-10">
                {newTextContent.length} / 160 caracteres
              </div>
            </div>

            <button
              onClick={handlePublishText}
              disabled={!newTextContent.trim()}
              className="w-full bg-teal-400 hover:bg-teal-500 text-white disabled:opacity-50 disabled:pointer-events-none font-bold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer"
            >
              <Check className="w-4 h-4" /> Compartir en Mi Estado
            </button>

            <StoryAudiencePicker audience={audience} onChange={handleSetAudience} contacts={contacts} />
          </div>
        )}

        {subView === "create_image" && (
          <div className="space-y-4 animate-fade-in">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSubView("list")}
                className="text-[9px] font-bold text-slate-500 hover:text-slate-800 flex items-center gap-0.5 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Volver
              </button>
              <h4 className="text-[10px] font-black uppercase text-slate-400">Crear Estado con Foto</h4>
            </div>

            {!selectedImageUrl ? (
              <button
                type="button"
                onClick={() => {
                  const el = document.getElementById("state-media-upload-input");
                  if (el) el.click();
                }}
                className="w-full aspect-[9/16] max-h-[300px] flex flex-col items-center justify-center gap-3 bg-white hover:bg-slate-50 rounded-2xl transition-all cursor-pointer border-2 border-dashed border-slate-300 hover:border-teal-400"
              >
                <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center">
                  <Upload className="w-5 h-5 text-teal-500" />
                </div>
                <span className="text-[11px] font-bold text-slate-500">Subir foto o video</span>
              </button>
            ) : (
              <div className="space-y-3">
                <div className="relative">
                  <div className="aspect-[9/16] max-h-[300px] w-full rounded-2xl overflow-hidden shadow-lg border border-slate-100 bg-black">
                    {selectedImageUrl && (
                      <img
                        src={selectedImageUrl}
                        alt="Vista previa"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none"></div>
                    <div className="absolute top-3 left-3">
                      <span className="text-[7px] font-bold tracking-widest uppercase bg-black/50 backdrop-blur-sm border border-white/15 px-2 py-1 rounded-full text-white/80">
                        Vista Previa
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setSelectedImageUrl(""); setNewImageCaption(""); }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center shadow-md transition-all cursor-pointer z-10"
                    title="Quitar foto"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <input
                    type="text"
                    placeholder="Escribe una leyenda..."
                    value={newImageCaption}
                    onChange={(e) => setNewImageCaption(e.target.value)}
                    maxLength={70}
                    className="w-full bg-gray-100 text-slate-800 text-[11px] font-medium px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-teal-500/20 placeholder-slate-400"
                  />
                  <div className="text-[7px] text-right text-slate-400 font-mono">
                    {newImageCaption.length} / 70
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handlePublishImage}
              disabled={!selectedImageUrl}
              className={`w-full font-bold text-[10px] py-3 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md cursor-pointer ${
                selectedImageUrl
                  ? "bg-teal-400 hover:bg-teal-500 text-white"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}
            >
              <Check className="w-4 h-4" /> Compartir en Mi Estado
            </button>

            <StoryAudiencePicker audience={audience} onChange={handleSetAudience} contacts={contacts} />
          </div>
        )}

      </div>

      {activeUserStates && (
        <StoryViewer
          activeUserStates={activeUserStates}
          activeStoryIdx={activeStoryIdx}
          storyProgress={storyProgress}
          reactionFeedback={reactionFeedback}
          myCurrentReaction={myCurrentReaction}
          viewersData={viewersData}
          showViewersSheet={showViewersSheet}
          storyReplyText={storyReplyText}
          onClose={handleCloseStoryViewer}
          onTap={handleStoryTap}
          isPaused={isStoryPaused}
          onSetPaused={setStoryPaused}
          onSendReply={handleSendReply}
          onToggleReaction={handleToggleReaction}
          onSetStoryReplyText={setStoryReplyText}
          onShowViewersSheet={setShowViewersSheet}
          onDeleteStory={handleDeleteMyStory}
        />
      )}

      {showViewersSheet && viewersData && (
        <StateViewersModal
          viewersData={viewersData}
          onClose={() => setShowViewersSheet(false)}
        />
      )}

      <CreateStateModal
        uploadedMedia={uploadedMedia!}
        showPublishDecisionModal={showPublishDecisionModal}
        publishStep={publishStep}
        publishComment={publishComment}
        isEditingProState={isEditingProState}
        onPublishOriginal={handlePublishOriginal}
        onPublishNow={handlePublishNow}
        onGoToProEditor={handleGoToProEditor}
        onBackToChoice={() => setPublishStep("choice")}
        onSetPublishComment={setPublishComment}
      />

      {isEditingProState && uploadedMedia && (
        <div className="absolute inset-0 bg-slate-900 z-50 flex flex-col overflow-hidden animate-fade-in">
          <MediaEditor
            isStateMode={true}
            initialMediaUrl={uploadedMedia.url}
            initialMediaType={uploadedMedia.type}
            onPublishState={handlePublishProState}
            onPublishFlyer={() => {}}
            onGoToFeed={() => {
              setIsEditingProState(false);
              setShowPublishDecisionModal(true);
            }}
          />
        </div>
      )}

      {/* Create state bottom sheet */}
      {showCreateMenu && (
        <div
          className="absolute inset-0 bg-black/50 z-[120] flex items-end"
          onClick={() => setShowCreateMenu(false)}
        >
          <div className="w-full bg-white rounded-t-3xl p-5 pb-8 space-y-2 animate-slide-up" onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
            <h4 className="text-xs font-black text-slate-800 mb-2">Nuevo estado</h4>
            <button
              onClick={openTextCreator}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-xl text-left transition-all cursor-pointer"
            >
              <Layout className="w-5 h-5 text-teal-600" />
              <span className="text-[11px] font-bold text-slate-700">Escribir Texto</span>
            </button>
            <button
              onClick={openStateMediaUpload}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-xl text-left transition-all cursor-pointer"
            >
              <Upload className="w-5 h-5 text-indigo-600" />
              <span className="text-[11px] font-bold text-slate-700">Subir Foto</span>
            </button>
            <button
              onClick={openStateMediaUpload}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 rounded-xl text-left transition-all cursor-pointer"
            >
              <Video className="w-5 h-5 text-amber-500" />
              <span className="text-[11px] font-bold text-slate-700">Subir Video (PRO)</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
