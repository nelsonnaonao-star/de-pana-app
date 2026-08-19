import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { addGroupMember, removeGroupMember, leaveGroup as apiLeaveGroup, updateChat, muteGroup, unmuteGroup, getGroupMute, MuteDuration } from "../../services/chats";
import { searchUsers } from "../../services/contacts";
import { logger } from "../../lib/logger";

import toast from "react-hot-toast";

export function useGroupManagement(chatId: string, chatName: string, uid: string, isGroup: boolean, showGroupInfo: boolean) {
  const [groupMembers, setGroupMembers] = useState<Array<{profile_id: string; name?: string; avatar?: string}>>([]);
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [localGroupName, setLocalGroupName] = useState(chatName);
  const [showAddMember, setShowAddMember] = useState(false);
  const [addMemberQuery, setAddMemberQuery] = useState("");
  const [addMemberResults, setAddMemberResults] = useState<Array<{id: string; name: string; avatar?: string}>>([]);
  const [addingMember, setAddingMember] = useState(false);
  const [isGroupMuted, setIsGroupMuted] = useState(false);
  const [muteUntil, setMuteUntil] = useState<string | null>(null);
  const [muting, setMuting] = useState(false);

  useEffect(() => {
    if (!isGroup || !chatId) return;
    let cancelled = false;
    (async () => {
      const { isMuted, muted_until } = await getGroupMute(chatId);
      if (!cancelled) {
        setIsGroupMuted(isMuted);
        setMuteUntil(muted_until);
      }
    })();
    return () => { cancelled = true; };
  }, [isGroup, chatId]);

  useEffect(() => { setLocalGroupName(chatName); }, [chatName]);

  useEffect(() => {
    if (!showGroupInfo || !isGroup) return;
    (async () => {
      try {
        const { data: rows } = await supabase
          .from("chat_participants")
          .select("profile_id, profiles(name, avatar_url)")
          .eq("chat_id", chatId);
        if (rows) {
          const mapped = rows.map((r: any) => ({
            profile_id: r.profile_id,
            name: r.profiles?.name,
            avatar: r.profiles?.avatar_url,
          }));
          setGroupMembers(mapped);
        }
      } catch (e) {
        logger.error("[CHAT] Error fetching group members", { error: e });
      }
    })();
  }, [showGroupInfo, isGroup, chatId]);

  useEffect(() => {
    if (addMemberQuery.trim().length < 2) {
      setAddMemberResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const results = await searchUsers(addMemberQuery, uid);
        const existingIds = new Set(groupMembers.map(m => m.profile_id));
        const filtered = results.filter(r => !existingIds.has(r.id));
        setAddMemberResults(filtered);
      } catch (e) {
        logger.warn("[CHAT] searchUsers failed", { error: e });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [addMemberQuery, uid, groupMembers]);

  const handleSaveGroupName = useCallback(async () => {
    if (!groupNameDraft.trim() || groupNameDraft.trim() === localGroupName) {
      setEditingGroupName(false);
      return;
    }
    try {
      const { updateChat } = await import("../../services/chats");
      await updateChat(chatId, { name: groupNameDraft.trim() });
      setLocalGroupName(groupNameDraft.trim());
      setEditingGroupName(false);
      toast.success("Nombre del grupo actualizado");
    } catch (e) {
      logger.error("[CHAT] Error updating group name", { error: e });
      toast.error("Error al actualizar nombre");
    }
  }, [groupNameDraft, localGroupName, chatId]);

  const handleAddMember = useCallback(async (profileId: string) => {
    setAddingMember(true);
    try {
      await addGroupMember(chatId, profileId);

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", profileId)
        .single();

      const memberName = profile?.name || "Nuevo participante";

      // Insert system message so the chat appears in the new member's list and triggers push
      const systemText = `👤 ${memberName} se unió al grupo`;
      try {
        await supabase.from("messages").insert({
          chat_id: chatId,
          sender_id: uid,
          text: systemText,
          type: "system",
          status: "sent",
          created_at: new Date().toISOString(),
          edited: false,
          forwarded: false,
          is_deleted: false,
          is_ephemeral: false,
          has_image: false,
          has_audio: false,
          has_video: false,
          has_document: false,
          has_location: false,
          is_animated: false,
        });
        await supabase
          .from("chats")
          .update({
            last_message: systemText,
            last_message_time: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", chatId);
      } catch (e) {
        logger.error("[CHAT] Failed to insert system message", { error: e });
      }

      if (profile) {
        setGroupMembers(prev => [...prev, { profile_id: profileId, name: profile.name, avatar: profile.avatar_url }]);
      }
      setShowAddMember(false);
      setAddMemberQuery("");
      setAddMemberResults([]);
      toast.success("Miembro agregado");
    } catch (e) {
      logger.error("[CHAT] Error adding member", { error: e });
      toast.error("Error al agregar miembro");
    } finally {
      setAddingMember(false);
    }
  }, [chatId, localGroupName, uid]);

  const handleRemoveMember = useCallback(async (profileId: string) => {
    try {
      await removeGroupMember(chatId, profileId);
      setGroupMembers(prev => prev.filter(m => m.profile_id !== profileId));
      toast.success("Miembro eliminado del grupo");
    } catch (e) {
      logger.error("[CHAT] Error removing member", { error: e });
      toast.error("Error al eliminar miembro");
    }
  }, [chatId]);

  const [groupAvatar, setGroupAvatar] = useState("");

  useEffect(() => {
    if (!showGroupInfo || !isGroup) return;
    (async () => {
      try {
        const { data } = await supabase.from("chats").select("avatar").eq("id", chatId).single();
        if (data) setGroupAvatar(data.avatar || "");
      } catch (e) {
        logger.warn("[CHAT] Error fetching group avatar", { error: e });
      }
    })();
  }, [showGroupInfo, isGroup, chatId]);

  const handleChangePhoto = useCallback(async (dataUrl: string): Promise<string | null> => {
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const { uploadChatMedia } = await import("../../services/storage");
      const url = await uploadChatMedia(blob, "uploads/avatars");
      await updateChat(chatId, { avatar: url });
      setGroupAvatar(url);
      toast.success("Foto de grupo actualizada");
      return url;
    } catch (e) {
      logger.error("[CHAT] Error changing group photo", { error: e });
      toast.error("Error al cambiar foto");
      return null;
    }
  }, [chatId]);

  const handleLeaveGroup = useCallback(async (): Promise<boolean> => {
    try {
      await apiLeaveGroup(chatId, uid);
      toast.success("Has salido del grupo");
      return true;
    } catch (e) {
      logger.error("[CHAT] Error leaving group", { error: e });
      toast.error("Error al salir del grupo");
      return false;
    }
  }, [chatId, uid]);

  const handleMuteGroup = useCallback(async (duration: MuteDuration) => {
    setMuting(true);
    try {
      await muteGroup(chatId, duration);
      setIsGroupMuted(true);
      setMuteUntil(duration === "always" ? null : null);
      toast.success(duration === "always" ? "Grupo silenciado (Siempre)" : `Grupo silenciado`);
    } catch (e) {
      logger.error("[CHAT] Error muting group", { error: e });
      toast.error("Error al silenciar el grupo");
    } finally {
      setMuting(false);
    }
  }, [chatId]);

  const handleUnmuteGroup = useCallback(async () => {
    setMuting(true);
    try {
      await unmuteGroup(chatId);
      setIsGroupMuted(false);
      setMuteUntil(null);
      toast.success("Sonido del grupo activado");
    } catch (e) {
      logger.error("[CHAT] Error unmuting group", { error: e });
      toast.error("Error al activar el sonido");
    } finally {
      setMuting(false);
    }
  }, [chatId]);

  return {
    groupMembers,
    editingGroupName,
    groupNameDraft,
    localGroupName,
    groupAvatar,
    showAddMember,
    addMemberQuery,
    addMemberResults,
    addingMember,
    setEditingGroupName,
    setGroupNameDraft,
    setShowAddMember,
    setAddMemberQuery,
    setAddMemberResults,
    handleSaveGroupName,
    handleAddMember,
    handleRemoveMember,
    handleChangePhoto,
    handleLeaveGroup,
    isGroupMuted,
    muteUntil,
    muting,
    handleMuteGroup,
    handleUnmuteGroup,
  };
}
