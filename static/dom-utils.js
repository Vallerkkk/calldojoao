export function reconcileNodes(parent, nodes) {
  const focused=document.activeElement,owner=parent.contains(focused)?focused.closest('[data-channel-id],[data-user-id],[data-participant-id],[data-message-id],[data-community-id]'):null;
  const identity=owner&&['channelId','userId','participantId','messageId','communityId'].find(key=>owner.dataset[key]);
  const value=identity&&owner.dataset[identity];
  let cursor = parent.firstChild;
  for (const node of nodes) {
    if (node === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(node, cursor);
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
  if(owner&&!focused.isConnected){const replacement=nodes.find(node=>node.dataset?.[identity]===value);if(replacement){const control=focused===owner?replacement:replacement.querySelector('summary')||replacement.querySelector('button,input');focusElement(control,replacement);}}
}

export function reserveImage(image, width = 480, height = 320) {
  image.width = width; image.height = height; image.decoding = 'async';
}

export function focusElement(element, fallback) {
  const target = element?.isConnected && !element.disabled && !element.closest('[hidden],.hidden,[inert]') ? element : fallback;
  target?.focus({preventScroll: true});
}
