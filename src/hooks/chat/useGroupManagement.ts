import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { addGroupMember, removeGroupMember, leaveGroup as apiLeaveGroup, updateChat } from "../../services/chats";
import { searchUsers } from "../../services/contacts";

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
        console.error("[CHAT] Error fetching group members:", e);
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
      } catch {}
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
      console.error("[CHAT] Error updating group name:", e);
      toast.error("Error al actualizar nombre");
    }
  }, [groupNameDraft, localGroupName, chatId]);

  const handleAddMember = useCallback(async (profileId: string) => {
    setAddingMember(true);
    try {
      await addGroupMember(chatId, profileId);

      // Insert system message so the chat appears in the new member's list and triggers push
      const systemText = `Nuevo miembro agregado`;
      try {
        await supabase.from("messages").insert({
          chat_id: chatId,
          sender_id: uid,
          text: systemText,
          type: "text",
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
        console.error("[CHAT] Failed to insert system message:", e);
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", profileId)
        .single();
      if (profile) {
        setGroupMembers(prev => [...prev, { profile_id: profileId, name: profile.name, avatar: profile.avatar_url }]);
      }
      setShowAddMember(false);
      setAddMemberQuery("");
      setAddMemberResults([]);
      toast.success("Miembro agregado");
    } catch (e) {
      console.error("[CHAT] Error adding member:", e);
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
      console.error("[CHAT] Error removing member:", e);
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
      } catch {}
    })();
  }, [showGroupInfo, isGroup, chatId]);

  const handleChangePhoto = useCallback(async (dataUrl: string) => {
    try {
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();
      const { uploadChatMedia } = await import("../../services/storage");
      const url = await uploadChatMedia(blob, "uploads/avatars");
      await updateChat(chatId, { avatar: url });
      setGroupAvatar(url);
      toast.success("Foto de grupo actualizada");
    } catch (e) {
      console.error("[CHAT] Error changing group photo:", e);
      toast.error("Error al cambiar foto");
    }
  }, [chatId]);

  const handleLeaveGroup = useCallback(async (): Promise<boolean> => {
    try {
      await apiLeaveGroup(chatId, uid);
      toast.success("Has salido del grupo");
      return true;
    } catch (e) {
      console.error("[CHAT] Error leaving group:", e);
      toast.error("Error al salir del grupo");
      return false;
    }
  }, [chatId, uid]);

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
  };
}
