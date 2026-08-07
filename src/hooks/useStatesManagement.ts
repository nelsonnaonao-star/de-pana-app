import { useState, useEffect, useRef, FormEvent, ChangeEvent, MouseEvent } from "react";
import { getAllStories, createStory, deleteStory, registerStoryView, getStoryViewers, toggleStoryReaction } from "../services/contentService";
import { updateProfile } from "../services/auth";
import { storyRepo } from "../services/database/repositories/StoryRepository";

export type StoryAudience =
  | { tipo: "todos" }
  | { tipo: "solo"; ids: string[] }
  | { tipo: "ocultar"; ids: string[] }
  | { tipo: "nadie" };

export function parseStoryAudience(raw?: string | null): StoryAudience {
  if (!raw) return { tipo: "todos" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.tipo === "solo" && Array.isArray(parsed.ids)) return { tipo: "solo", ids: parsed.ids };
    if (parsed?.tipo === "ocultar" && Array.isArray(parsed.ids)) return { tipo: "ocultar", ids: parsed.ids };
    if (parsed?.tipo === "nadie") return { tipo: "nadie" };
    return { tipo: "todos" };
  } catch {
    return { tipo: "todos" };
  }
}

export function audienceToJson(audience: StoryAudience): string {
  return JSON.stringify(audience);
}

export interface Story {
  id: string;
  type: "text" | "image" | "video";
  content: string;
  caption?: string;
  background?: string;
  time: string;
}

export interface UserState {
  id: string;
  userName: string;
  userAvatar: string;
  stories: Story[];
  hasUnseen: boolean;
  isMe?: boolean;
}

export const GRADIENTS = [
  "from-indigo-600 via-purple-600 to-pink-500",
  "from-emerald-500 to-teal-700",
  "from-rose-500 to-orange-500",
  "from-slate-900 via-purple-900 to-slate-900",
  "from-cyan-500 to-blue-600",
  "from-amber-500 to-rose-600"
];

interface UseStatesManagementParams {
  userId: string;
  profileName?: string;
  profileAvatar?: string;
  defaultAudience?: string;
  onStartChat: (name: string, avatar: string, initialText: string) => void;
  onHasUnseen?: (unseen: boolean) => void;
}

export function useStatesManagement({ userId, profileName, profileAvatar, defaultAudience, onStartChat, onHasUnseen }: UseStatesManagementParams) {
  const [userStates, setUserStates] = useState<UserState[]>([]);
  const [myStories, setMyStories] = useState<Story[]>([]);
  const [subView, setSubView] = useState<"list" | "create_text" | "create_image">("list");
  const [audience, setAudience] = useState<StoryAudience>(() => parseStoryAudience(defaultAudience));

  const [uploadedMedia, setUploadedMedia] = useState<{ url: string; type: "image" | "video"; name: string } | null>(null);
  const [showPublishDecisionModal, setShowPublishDecisionModal] = useState(false);
  const [isEditingProState, setIsEditingProState] = useState(false);
  const [publishStep, setPublishStep] = useState<"choice" | "comment">("choice");
  const [publishComment, setPublishComment] = useState("");

  const [activeUserStates, setActiveUserStates] = useState<UserState | null>(null);
  const [activeStoryIdx, setActiveStoryIdx] = useState(0);
  const [storyProgress, setStoryProgress] = useState(0);
  const [storyReplyText, setStoryReplyText] = useState("");
  const [isStoryPaused, setIsStoryPaused] = useState(false);
  const isStoryPausedRef = useRef(false);

  const [viewersData, setViewersData] = useState<{ viewers: Array<{ viewer_id: string; name: string; avatar: string; viewed_at: string; reactions: string[] }>; total: number } | null>(null);
  const [showViewersSheet, setShowViewersSheet] = useState(false);
  const [myCurrentReaction, setMyCurrentReaction] = useState<string | null>(null);
  const [reactionFeedback, setReactionFeedback] = useState<string | null>(null);

  const [newTextContent, setNewTextContent] = useState("");
  const [selectedGradientIdx, setSelectedGradientIdx] = useState(0);

  const [newImageCaption, setNewImageCaption] = useState("");
  const [selectedImageUrl, setSelectedImageUrl] = useState("");

  const buildState = (apiStories: any[], cached = false) => {
    const myList: Story[] = [];
    const grouped: Record<string, any> = {};

    for (const s of apiStories) {
      if (s.user_id === userId) {
        myList.push({
          id: s.id,
          type: s.type,
          content: s.content,
          caption: s.caption || undefined,
          background: s.background || undefined,
          time: s.created_at ? new Date(s.created_at).toLocaleString() : '',
        });
      } else {
        if (!grouped[s.user_id]) {
          grouped[s.user_id] = {
            id: s.user_id + '_state',
            userName: s.profiles?.name || 'Usuario',
            userAvatar: s.profiles?.avatar_url || '',
            hasUnseen: false,
            stories: [],
          };
        }
        if (!cached && !s.viewed) {
          grouped[s.user_id].hasUnseen = true;
        }
        grouped[s.user_id].stories.push({
          id: s.id,
          type: s.type,
          content: s.content,
          caption: s.caption || undefined,
          background: s.background || undefined,
          time: s.created_at ? new Date(s.created_at).toLocaleString() : '',
        });
      }
    }

    setMyStories(myList);
    const groupedList = Object.values(grouped);
    setUserStates(groupedList);
    if (!cached) {
      const hasUnseen = (groupedList as any[]).some((u: any) => u.hasUnseen);
      onHasUnseen?.(hasUnseen);
    }
  };

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;

    // 1. Cache-first: show stories from SQLite immediately
    storyRepo.getAllStories().then(cached => {
      if (cancelled || cached.length === 0) return;
      if (userStates.length === 0) {
        buildState(cached, true);
      }
    });

    // 2. Network refresh in background
    getAllStories().then(apiStories => {
      if (cancelled) return;

      // Save to cache
      storyRepo.saveStories(apiStories);
      storyRepo.clearExpired();

      if (!apiStories || apiStories.length === 0) {
        if (userStates.length > 0) return;
        setUserStates([]);
        setMyStories([]);
        return;
      }

      buildState(apiStories, false);
    }).catch(err => {
      console.error("[StatesPanel] fetch stories failed:", err);
      // cached stories already shown — keep them
    });

    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!reactionFeedback) return;
    const t = setTimeout(() => setReactionFeedback(null), 1200);
    return () => clearTimeout(t);
  }, [reactionFeedback]);

  useEffect(() => {
    if (!activeUserStates) return;

    setStoryProgress(0);
    const interval = setInterval(() => {
      if (isStoryPausedRef.current) return;
      setStoryProgress(prev => {
        if (prev >= 100) {
          if (activeStoryIdx < activeUserStates.stories.length - 1) {
            setActiveStoryIdx(idx => idx + 1);
            return 0;
          } else {
            handleCloseStoryViewer();
            return 0;
          }
        }
        return prev + 2;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [activeUserStates, activeStoryIdx]);

  useEffect(() => {
    if (!activeUserStates || activeUserStates.stories.length === 0) return;
    const currentStory = activeUserStates.stories[activeStoryIdx];
    if (!currentStory) {
      handleCloseStoryViewer();
      return;
    }
    if (activeUserStates.isMe) {
      getStoryViewers(currentStory.id).then(setViewersData).catch(err => console.error("[StatesPanel] getStoryViewers failed:", err));
    } else {
      registerStoryView(currentStory.id).catch(err => console.error("[StatesPanel] registerStoryView failed:", err));
    }
    setMyCurrentReaction(null);

    const nextIdx = activeStoryIdx + 1;
    if (nextIdx < activeUserStates.stories.length) {
      const nextStory = activeUserStates.stories[nextIdx];
      if (nextStory.type === "image" || nextStory.type === "video") {
        const link = document.createElement("link");
        link.rel = "prefetch";
        link.href = nextStory.content;
        link.as = nextStory.type === "video" ? "video" : "image";
        document.head.appendChild(link);
        setTimeout(() => document.head.removeChild(link), 5000);
      }
    }
  }, [activeUserStates?.id, activeStoryIdx]);

  const handleOpenStoryViewer = (userState: UserState) => {
    if (!userState.stories || userState.stories.length === 0) return;
    setStoryPaused(false);
    setActiveUserStates(userState);
    setActiveStoryIdx(0);
    setStoryProgress(0);
    setMyCurrentReaction(null);
    setViewersData(null);
    setShowViewersSheet(false);

    if (!userState.isMe) {
      setUserStates(prev => {
        const next = prev.map(u => u.id === userState.id ? { ...u, hasUnseen: false } : u);
        const stillUnseen = next.some(u => u.hasUnseen);
        if (!stillUnseen) onHasUnseen?.(false);
        return next;
      });
    }
  };

  const handleCloseStoryViewer = () => {
    setStoryPaused(false);
    setActiveUserStates(null);
    setStoryReplyText("");
  };

  const handleStoryTap = (direction: "prev" | "next") => {
    if (!activeUserStates) return;

    if (direction === "prev") {
      if (activeStoryIdx > 0) {
        setActiveStoryIdx(idx => idx - 1);
        setStoryProgress(0);
      }
    } else {
      if (activeStoryIdx < activeUserStates.stories.length - 1) {
        setActiveStoryIdx(idx => idx + 1);
        setStoryProgress(0);
      } else {
        handleCloseStoryViewer();
      }
    }
  };

  const handleSendReply = (e: FormEvent) => {
    e.preventDefault();
    if (!storyReplyText.trim() || !activeUserStates) return;

    const currentStory = activeUserStates.stories[activeStoryIdx];
    const contextQuote = currentStory.type === "text"
      ? `"${currentStory.content}"`
      : `[${currentStory.type === "video" ? "Video" : "Imagen"} de Estado]`;

    const initialText = `Respondí a tu estado ${contextQuote}:\n\n${storyReplyText}`;

    onStartChat(activeUserStates.userName, activeUserStates.userAvatar, initialText);
    handleCloseStoryViewer();
  };

  const saveStoryToApi = (story: Story) => {
    if (!userId) return;
    createStory({
      user_id: userId,
      type: story.type,
      content: story.content,
      audience: audienceToJson(audience),
    }).catch(err => console.error("[StatesPanel] createStory failed:", err));
  };

  const handlePublishText = () => {
    if (!newTextContent.trim()) return;

    const newStory: Story = {
      id: "my_text_" + Date.now(),
      type: "text",
      content: newTextContent,
      background: GRADIENTS[selectedGradientIdx],
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setNewTextContent("");
    setSubView("list");
  };

  const handlePublishImage = () => {
    const newStory: Story = {
      id: "my_img_" + Date.now(),
      type: "image",
      content: selectedImageUrl,
      caption: newImageCaption,
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setNewImageCaption("");
    setSubView("list");
  };

  const handleFileUploaded = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileType = file.type.startsWith("video") ? "video" : "image";
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        setSelectedImageUrl(event.target.result as string);
        setUploadedMedia({
          url: event.target.result as string,
          type: fileType,
          name: file.name
        });
        setShowPublishDecisionModal(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handlePublishOriginal = () => {
    if (!uploadedMedia) return;
    setPublishStep("comment");
    setPublishComment("");
  };

  const handlePublishNow = () => {
    if (!uploadedMedia) return;

    const newStory: Story = {
      id: "my_upload_" + Date.now(),
      type: uploadedMedia.type,
      content: uploadedMedia.url,
      caption: publishComment.trim(),
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setUploadedMedia(null);
    setShowPublishDecisionModal(false);
    setPublishStep("choice");
    setPublishComment("");
    setSubView("list");
  };

  const handleGoToProEditor = () => {
    setShowPublishDecisionModal(false);
    setIsEditingProState(true);
  };

  const handlePublishProState = (editedUrl: string, mediaType: "image" | "video", caption: string) => {
    const newStory: Story = {
      id: "my_pro_" + Date.now(),
      type: mediaType,
      content: editedUrl,
      caption: caption || "Editado con Red On PRO Editor ✨🎨",
      time: "Ahora mismo"
    };

    setMyStories(prev => [newStory, ...prev]);
    saveStoryToApi(newStory);
    setIsEditingProState(false);
    setUploadedMedia(null);
    setSubView("list");
  };

  const handleDeleteMyStory = (storyId: string, e: MouseEvent) => {
    e.stopPropagation();
    setMyStories(prev => prev.filter(s => s.id !== storyId));
    deleteStory(storyId).catch(err => console.error("[StatesPanel] deleteStory failed:", err));
  };

  const myUserStateRepresentation: UserState = {
    id: "me_state",
    userName: "Mi Estado (" + (profileName || "Yo") + ")",
    userAvatar: profileAvatar || "",
    stories: myStories,
    hasUnseen: false,
    isMe: true
  };

  const handleToggleReaction = (storyId: string, emoji: string) => {
    toggleStoryReaction(storyId, emoji).then((res) => {
      if (res.reacted) {
        setMyCurrentReaction(emoji);
        setReactionFeedback(emoji);
      } else {
        setMyCurrentReaction(null);
        setReactionFeedback(emoji);
      }
    }).catch(err => console.error("[StatesPanel] toggleStoryReaction failed:", err));
  };

  const handleSetAudience = (next: StoryAudience) => {
    setAudience(next);
    if (userId) {
      const json = audienceToJson(next);
      updateProfile(userId, { default_story_audience: json }).catch(err =>
        console.error("[StatesPanel] save default audience failed:", err)
      );
    }
  };

  const setStoryPaused = (paused: boolean) => {
    isStoryPausedRef.current = paused;
    setIsStoryPaused(paused);
  };

  return {
    userStates,
    myStories,
    subView,
    audience,
    handleSetAudience,
    uploadedMedia,
    showPublishDecisionModal,
    isEditingProState,
    publishStep,
    publishComment,
    activeUserStates,
    activeStoryIdx,
    storyProgress,
    storyReplyText,
    isStoryPaused,
    setStoryPaused,
    viewersData,
    showViewersSheet,
    myCurrentReaction,
    reactionFeedback,
    newTextContent,
    selectedGradientIdx,
    newImageCaption,
    selectedImageUrl,
    myUserStateRepresentation,
    GRADIENTS,
    setSubView,
    setPublishComment,
    setShowPublishDecisionModal,
    setShowViewersSheet,
    setPublishStep,
    setIsEditingProState,
    setNewTextContent,
    setSelectedGradientIdx,
    setNewImageCaption,
    setSelectedImageUrl,
    setStoryReplyText,
    handleOpenStoryViewer,
    handleCloseStoryViewer,
    handleStoryTap,
    handleSendReply,
    handlePublishText,
    handlePublishImage,
    handleFileUploaded,
    handlePublishOriginal,
    handlePublishNow,
    handleGoToProEditor,
    handlePublishProState,
    handleDeleteMyStory,
    handleToggleReaction,
  };
}
